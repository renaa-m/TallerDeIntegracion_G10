import './landing_page.css'
import { useEffect, useRef, useState, useCallback } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useAuth0 } from '@auth0/auth0-react'
import {
  ChevronLeft,
  ChevronRight,
  FolderPlus,
  Pencil,
  Trash2,
  Loader2,
} from 'lucide-react'
import AppLoading from '../../components/ui/app_loading'
import ModalEliminarColeccion from '../../components/modal_eliminar_coleccion/modal_eliminar_coleccion'
import ModalRenombrarColeccion from '../../components/modal_renombrar_coleccion/modal_renombrar_coleccion'
import {
  getCollectionCardProgressLabel,
  isPipelineRunning,
  MODAL_ETAPA_KEY,
  clearActiveCollectionStorageIfMatch,
} from '../../lib/collection_processing'

interface Collection {
  id: string
  user_id: string
  name: string
  description: string | null
  status: string
  processing_status?: string
  text_progress_total?: number
  text_progress_processed?: number
  graph_progress_total?: number
  graph_progress_processed?: number
  created_at: string
}

const API_BASE = import.meta.env.VITE_API_URL?.replace(/\/$/, '') || ''

function formatDisplayName(raw: string): string {
  return raw
    .split(/\s+/)
    .map((part) => {
      if (!part) return part
      if (part.includes('/')) {
        return part
          .split('/')
          .map((segment) =>
            segment
              ? segment.charAt(0).toUpperCase() + segment.slice(1).toLowerCase()
              : segment,
          )
          .join('/')
      }
      return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()
    })
    .join(' ')
}

function formatCollectionDate(iso: string): string {
  return new Intl.DateTimeFormat('es-CL', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(iso))
}

function LandingPage() {
  const { id_usuario } = useParams<{ id_usuario: string }>()
  const { user, getAccessTokenSilently, isAuthenticated, isLoading } =
    useAuth0()

  const [estado, setEstado] = useState<
    'idle' | 'loading' | 'success' | 'error'
  >('idle')
  const [mensaje, setMensaje] = useState('')

  const currentUserId = user?.sub?.split('|')[1] || user?.nickname
  const navigate = useNavigate()

  const [colecciones, setColecciones] = useState<Collection[]>([])
  const [cargandoColecciones, setCargandoColecciones] = useState(true)
  const [deletingIds, setDeletingIds] = useState<Set<string>>(() => new Set())
  const [coleccionAEliminar, setColeccionAEliminar] =
    useState<Collection | null>(null)
  const [coleccionAEditar, setColeccionAEditar] = useState<Collection | null>(
    null,
  )
  const [guardandoNombre, setGuardandoNombre] = useState(false)
  const collectionsScrollerRef = useRef<HTMLDivElement>(null)
  const [collectionsScroll, setCollectionsScroll] = useState({
    canLeft: false,
    canRight: false,
  })

  const coleccionesRef = useRef(colecciones)
  const refreshRequestIdRef = useRef(0)

  useEffect(() => {
    coleccionesRef.current = colecciones
  }, [colecciones])

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      navigate('/login', { replace: true })
    }
  }, [isLoading, isAuthenticated, navigate])

  const refreshColecciones = useCallback(
    async (options?: { silent?: boolean }) => {
      const requestId = ++refreshRequestIdRef.current
      try {
        const token = await getAccessTokenSilently()
        const response = await fetch(`${API_BASE}/api/collections`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        })
        const data = await response.json()
        if (!response.ok) {
          throw new Error(data?.detail || 'Error al cargar colecciones')
        }
        if (requestId !== refreshRequestIdRef.current) return
        setColecciones(Array.isArray(data) ? data : [])
        if (!options?.silent) {
          setEstado('idle')
          setMensaje('')
        }
      } catch (error) {
        console.error('Error cargando colecciones:', error)
        if (!options?.silent) {
          setEstado('error')
          setMensaje('No se pudieron cargar las colecciones')
        }
      }
    },
    [getAccessTokenSilently],
  )

  const handleIniciar = async () => {
    localStorage.removeItem(MODAL_ETAPA_KEY)
    navigate(`/${id_usuario || currentUserId}/colecciones/nueva/buscador`, {
      state: { abrirModalCarga: true },
    })
  }

  const confirmarEdicion = async (nuevoNombre: string) => {
    if (!coleccionAEditar) return

    setGuardandoNombre(true)

    try {
      const token = await getAccessTokenSilently()

      const response = await fetch(
        `${API_BASE}/api/collections/${coleccionAEditar.id}`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            name: nuevoNombre.trim(),
          }),
        },
      )

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data?.detail || 'Error al actualizar la colección')
      }

      setColecciones((prev) =>
        prev.map((coleccion) =>
          coleccion.id === coleccionAEditar.id
            ? { ...coleccion, name: data.name }
            : coleccion,
        ),
      )
      setColeccionAEditar(null)
    } catch (error) {
      console.error('Error editando colección:', error)
      setEstado('error')
      setMensaje('No se pudo cambiar el nombre de la colección')
    } finally {
      setGuardandoNombre(false)
    }
  }

  const confirmarEliminacion = async () => {
    if (!coleccionAEliminar || deletingIds.has(coleccionAEliminar.id)) return

    const idColeccion = coleccionAEliminar.id
    setDeletingIds((prev) => new Set(prev).add(idColeccion))

    try {
      const token = await getAccessTokenSilently()

      const response = await fetch(
        `${API_BASE}/api/collections/${idColeccion}`,
        {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      )

      if (!response.ok) {
        const text = await response.text()
        let detail = 'Error al eliminar la colección'
        if (text) {
          try {
            detail = JSON.parse(text)?.detail ?? detail
          } catch {
            detail = text
          }
        }
        throw new Error(detail)
      }

      clearActiveCollectionStorageIfMatch(idColeccion)
      setColecciones((prev) =>
        prev.filter((coleccion) => coleccion.id !== idColeccion),
      )
      setColeccionAEliminar(null)
    } catch (error) {
      console.error('Error eliminando colección:', error)
      setEstado('error')
      setMensaje('No se pudo eliminar la colección')
    } finally {
      setDeletingIds((prev) => {
        const next = new Set(prev)
        next.delete(idColeccion)
        return next
      })
    }
  }

  useEffect(() => {
    const fetchColecciones = async () => {
      setCargandoColecciones(true)
      await refreshColecciones()
      setCargandoColecciones(false)
    }

    void fetchColecciones()
  }, [refreshColecciones])

  useEffect(() => {
    const interval = window.setInterval(() => {
      const hayProcesando = coleccionesRef.current.some((c) =>
        isPipelineRunning(c.processing_status),
      )
      if (!hayProcesando) return
      void refreshColecciones({ silent: true })
    }, 5000)

    return () => clearInterval(interval)
  }, [refreshColecciones])

  const abrirColeccionExistente = (idColeccion: string) => {
    navigate(
      `/${id_usuario || currentUserId}/colecciones/${idColeccion}/buscador`,
      {
        state: { abrirModalCarga: false },
      },
    )
  }

  const cerrarPopup = () => {
    setEstado('idle')
    setMensaje('')
  }

  const updateCollectionsScrollState = useCallback(() => {
    const scroller = collectionsScrollerRef.current
    if (!scroller) return

    const maxScrollLeft = scroller.scrollWidth - scroller.clientWidth
    setCollectionsScroll({
      canLeft: scroller.scrollLeft > 4,
      canRight: scroller.scrollLeft < maxScrollLeft - 4,
    })
  }, [])

  const scrollCollections = (direction: 'left' | 'right') => {
    const scroller = collectionsScrollerRef.current
    if (!scroller) return

    scroller.scrollBy({
      left: direction === 'left' ? -280 : 280,
      behavior: 'smooth',
    })
  }

  useEffect(() => {
    const syncScrollState = () => {
      requestAnimationFrame(() => updateCollectionsScrollState())
    }

    syncScrollState()

    const scroller = collectionsScrollerRef.current
    if (!scroller) return

    scroller.addEventListener('scroll', updateCollectionsScrollState)
    window.addEventListener('resize', syncScrollState)

    return () => {
      scroller.removeEventListener('scroll', updateCollectionsScrollState)
      window.removeEventListener('resize', syncScrollState)
    }
  }, [colecciones, cargandoColecciones, updateCollectionsScrollState])

  if (isLoading || !isAuthenticated || !user) {
    return <AppLoading message="Cargando sesión..." />
  }

  if (id_usuario !== currentUserId) {
    return (
      <div className="landing-page">
        <div className="landing-page-content">
          <main className="container">
            <section className="welcome">
              <h1 className="title">Acceso denegado</h1>
              <p className="subtitle">
                No tienes permiso para ver esta colección.
              </p>
            </section>
          </main>
        </div>
      </div>
    )
  }

  const displayName = formatDisplayName(
    user.given_name || user.nickname || 'investigador/a',
  )
  const tieneColecciones = colecciones.length > 0
  const ctaLabel = tieneColecciones ? 'Nueva Colección' : 'Iniciar'

  return (
    <div className="landing-page">
      <div className="landing-page-content">
        <main className="container">
          <section className="welcome">
            {!tieneColecciones && !cargandoColecciones && (
              <span className="badge">Bienvenido/a</span>
            )}

            <h1 className="title">¡Hola, {displayName}!</h1>

            <p className="subtitle">
              {tieneColecciones
                ? '¿Qué quieres explorar hoy?'
                : 'Crea tu primera colección y empieza a reunir tus documentos en un solo lugar.'}
            </p>

            <button
              type="button"
              className="landing-cta"
              onClick={handleIniciar}
            >
              <FolderPlus size={18} aria-hidden />
              {ctaLabel}
            </button>
          </section>

          {!cargandoColecciones && colecciones.length === 0 && (
            <p className="collections-empty-message">
              No tienes colecciones todavía. Usa el botón de arriba para crear
              la primera.
            </p>
          )}
        </main>

        {(cargandoColecciones || colecciones.length > 0) && (
          <section className="collections-panel" aria-label="Tus Colecciones">
            <div className="collections-panel-shell">
              <div className="collections-panel-header">
                <div className="collections-panel-heading">
                  <h2 className="collections-title">Tus Colecciones</h2>
                  {tieneColecciones && colecciones.length > 3 && (
                    <p className="collections-panel-hint">
                      Desliza para ver más
                    </p>
                  )}
                </div>
                {tieneColecciones && (
                  <span className="collections-count">
                    {colecciones.length}{' '}
                    {colecciones.length === 1 ? 'Colección' : 'Colecciones'}
                  </span>
                )}
              </div>

              {cargandoColecciones ? (
                <div className="collections-panel-body collections-panel-body-loading">
                  <AppLoading message="Cargando colecciones..." compact />
                </div>
              ) : (
                <div className="collections-panel-body">
                  <div className="collections-carousel">
                    <button
                      type="button"
                      className="collections-nav collections-nav-prev"
                      aria-label="Ver colecciones anteriores"
                      onClick={() => scrollCollections('left')}
                      disabled={!collectionsScroll.canLeft}
                    >
                      <ChevronLeft size={20} aria-hidden />
                    </button>

                    <div
                      ref={collectionsScrollerRef}
                      className="collections-scroller"
                      tabIndex={0}
                    >
                      <ul className="collections-track">
                        {colecciones.map((coleccion) => {
                          const progressLabel =
                            getCollectionCardProgressLabel(coleccion)

                          return (
                            <li key={coleccion.id}>
                              <article className="card">
                                <div className="card-actions">
                                  <button
                                    type="button"
                                    className="card-icon-btn"
                                    aria-label="Editar Colección"
                                    onClick={() =>
                                      setColeccionAEditar(coleccion)
                                    }
                                  >
                                    <Pencil size={18} />
                                  </button>

                                  <button
                                    type="button"
                                    className="card-icon-btn card-icon-delete"
                                    aria-label="Eliminar Colección"
                                    disabled={deletingIds.has(coleccion.id)}
                                    onClick={() =>
                                      setColeccionAEliminar(coleccion)
                                    }
                                  >
                                    {deletingIds.has(coleccion.id) ? (
                                      <Loader2
                                        size={18}
                                        className="landing-delete-spin"
                                      />
                                    ) : (
                                      <Trash2 size={18} />
                                    )}
                                  </button>
                                </div>

                                <button
                                  type="button"
                                  className="card-open"
                                  aria-label={`Abrir Colección ${coleccion.name}`}
                                  onClick={() =>
                                    abrirColeccionExistente(coleccion.id)
                                  }
                                >
                                  <div className="card-body">
                                    <h3>{coleccion.name}</h3>
                                    <p className="card-date">
                                      Creada el{' '}
                                      {formatCollectionDate(
                                        coleccion.created_at,
                                      )}
                                    </p>
                                    {(() => {
                                      if (!progressLabel) return null
                                      return (
                                        <p
                                          className="card-progress"
                                          role="status"
                                        >
                                          {isPipelineRunning(
                                            coleccion.processing_status,
                                          ) && (
                                            <Loader2
                                              size={14}
                                              className="card-progress-spin"
                                              aria-hidden
                                            />
                                          )}
                                          <span>{progressLabel}</span>
                                        </p>
                                      )
                                    })()}
                                  </div>
                                </button>
                              </article>
                            </li>
                          )
                        })}
                      </ul>
                    </div>

                    <button
                      type="button"
                      className="collections-nav collections-nav-next"
                      aria-label="Ver más colecciones"
                      onClick={() => scrollCollections('right')}
                      disabled={!collectionsScroll.canRight}
                    >
                      <ChevronRight size={20} aria-hidden />
                    </button>
                  </div>
                </div>
              )}
            </div>
          </section>
        )}
      </div>

      <ModalRenombrarColeccion
        isOpen={coleccionAEditar !== null}
        nombreActual={coleccionAEditar?.name ?? ''}
        isSaving={guardandoNombre}
        onConfirm={confirmarEdicion}
        onClose={() => {
          if (!guardandoNombre) setColeccionAEditar(null)
        }}
      />

      <ModalEliminarColeccion
        isOpen={coleccionAEliminar !== null}
        nombreColeccion={coleccionAEliminar?.name}
        isConfirming={
          coleccionAEliminar ? deletingIds.has(coleccionAEliminar.id) : false
        }
        onConfirm={() => void confirmarEliminacion()}
        onClose={() => {
          if (!coleccionAEliminar || !deletingIds.has(coleccionAEliminar.id)) {
            setColeccionAEliminar(null)
          }
        }}
      />

      {estado !== 'idle' && (
        <div className="popup-overlay">
          <div className={`popup-box popup-${estado}`}>
            <h3 className="popup-title">
              {estado === 'loading' && 'Procesando'}
              {estado === 'success' && 'Éxito'}
              {estado === 'error' && 'Error'}
            </h3>

            <p className="popup-message">{mensaje}</p>

            {estado === 'loading' ? (
              <div className="spinner"></div>
            ) : (
              <button className="popup-button" onClick={cerrarPopup}>
                Cerrar
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default LandingPage
