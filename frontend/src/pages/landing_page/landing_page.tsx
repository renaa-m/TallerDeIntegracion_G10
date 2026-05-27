import './landing_page.css'
import { useEffect, useRef, useState, useCallback } from 'react'
import { useNavigate, useParams } from 'react-router-dom' // Importar para capturar el :id_usuario y navegar
import { useAuth0 } from '@auth0/auth0-react' // Para validar contra el usuario real
import { Pencil, Trash2, Loader2 } from 'lucide-react'
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

const API_BASE =
  import.meta.env.VITE_API_URL?.replace(/\/$/, '') || 'http://localhost:8080'

function LandingPage() {
  const { id_usuario } = useParams<{ id_usuario: string }>() // Captura el parámetro de la URL
  const { user, getAccessTokenSilently } = useAuth0() // Obtenemos la info del usuario logueado

  const [estado, setEstado] = useState<
    'idle' | 'loading' | 'success' | 'error'
  >('idle')
  const [mensaje, setMensaje] = useState('')

  // Opcional: Validación de seguridad
  // Extraemos el ID real del token para comparar con la URL
  const currentUserId = user?.sub?.split('|')[1] || user?.nickname
  const navigate = useNavigate()

  const [colecciones, setColecciones] = useState<Collection[]>([])
  const [cargandoColecciones, setCargandoColecciones] = useState(true)
  const [deletingIds, setDeletingIds] = useState<Set<string>>(() => new Set())
  const coleccionesRef = useRef(colecciones)
  const refreshRequestIdRef = useRef(0)

  useEffect(() => {
    coleccionesRef.current = colecciones
  }, [colecciones])

  const refreshColecciones = useCallback(async (options?: { silent?: boolean }) => {
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
  }, [getAccessTokenSilently])

  const handleIniciar = async () => {
    localStorage.removeItem(MODAL_ETAPA_KEY)
    navigate(`/${id_usuario || currentUserId}/colecciones/nueva/buscador`, {
      state: { abrirModalCarga: true },
    })
  }

  const editarColeccion = async (idColeccion: string, nombreActual: string) => {
    const nuevoNombre = window.prompt(
      'Nuevo nombre de la colección:',
      nombreActual,
    )

    if (!nuevoNombre || nuevoNombre.trim() === '') return

    try {
      const token = await getAccessTokenSilently()

      const response = await fetch(
        `${API_BASE}/api/collections/${idColeccion}`,
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
          coleccion.id === idColeccion
            ? { ...coleccion, name: data.name }
            : coleccion,
        ),
      )
    } catch (error) {
      console.error('Error editando colección:', error)
      setEstado('error')
      setMensaje('No se pudo cambiar el nombre de la colección')
    }
  }

  const eliminarColeccion = async (idColeccion: string) => {
    if (deletingIds.has(idColeccion)) return

    const confirmar = window.confirm(
      '¿Seguro quieres eliminar esta colección? Esta acción no se puede deshacer',
    )

    if (!confirmar) return

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

  // Si alguien intenta entrar a un ID que no es el suyo, podrías bloquearlo aquí
  if (id_usuario !== currentUserId) {
    return (
      <main className="container">
        <section className="welcome">
          <h1 className="title">Acceso denegado</h1>
          <p className="subtitle">No tienes permiso para ver esta colección.</p>
        </section>
      </main>
    )
  }

  return (
    <>
      <main className="container">
        <section className="welcome">
          <span className="badge">Bienvenida</span>

          <h1 className="title">
            ¡Hola, {user?.given_name || user?.nickname}!
          </h1>

          <p className="subtitle">
            Crea tu primera colección y empieza a reunir todo lo importante en
            un solo lugar.
          </p>

          <button className="primary-btn" onClick={handleIniciar}>
            Iniciar
          </button>
        </section>

        <section className="collections">
          <h2 className="collections-title">Colecciones anteriores</h2>

          <div className="grid">
            {cargandoColecciones ? (
              <p>Cargando colecciones...</p>
            ) : colecciones.length === 0 ? (
              <p>No tienes colecciones todavía.</p>
            ) : (
              colecciones.map((coleccion) => (
                <div
                  key={coleccion.id}
                  role="button"
                  tabIndex={0}
                  className="card"
                  onClick={() => abrirColeccionExistente(coleccion.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      abrirColeccionExistente(coleccion.id)
                    }
                  }}
                >
                  <div className="card-actions">
                    <button
                      type="button"
                      className="card-icon-btn"
                      aria-label="Editar colección"
                      onClick={(e) => {
                        e.stopPropagation()
                        editarColeccion(coleccion.id, coleccion.name)
                      }}
                    >
                      <Pencil size={18} />
                    </button>

                    <button
                      type="button"
                      className="card-icon-btn card-icon-delete"
                      aria-label="Eliminar colección"
                      disabled={deletingIds.has(coleccion.id)}
                      onClick={(e) => {
                        e.stopPropagation()
                        void eliminarColeccion(coleccion.id)
                      }}
                    >
                      {deletingIds.has(coleccion.id) ? (
                        <Loader2 size={18} className="landing-delete-spin" />
                      ) : (
                        <Trash2 size={18} />
                      )}
                    </button>
                  </div>

                  <div className="card-body">
                    <h3>{coleccion.name}</h3>
                    {(() => {
                      const progressLabel =
                        getCollectionCardProgressLabel(coleccion)
                      if (!progressLabel) return null
                      return (
                        <p className="card-progress" role="status">
                          {isPipelineRunning(coleccion.processing_status) && (
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
                </div>
              ))
            )}
          </div>
        </section>
      </main>

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
    </>
  )
}

export default LandingPage
