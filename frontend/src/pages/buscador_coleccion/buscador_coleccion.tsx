import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  useNavigate,
  useParams,
  useSearchParams,
  useLocation,
  Outlet,
} from 'react-router-dom'
import { useAuth0 } from '@auth0/auth0-react'
import {
  Search,
  Network,
  SlidersHorizontal,
  Trash2,
  Files,
  Edit2,
  ExternalLink,
  FileText,
  CheckCircle2,
  Loader2,
} from 'lucide-react'

import { Link } from 'react-router-dom'

// Componentes
import ModalCarga from '../../components/modal_carga/modal_carga'
import ModalEliminarColeccion from '../../components/modal_eliminar_coleccion/modal_eliminar_coleccion'
import ModalDocumentosDisponibles from '../../components/modal_documentos_disponibles/modal_documentos_disponibles'

import {
  ACTIVE_COLLECTION_KEY,
  MODAL_ETAPA_KEY,
  type CollectionProcessingSnapshot,
  clearActiveCollectionStorageIfMatch,
  clearStaleActiveCollectionForPage,
  getPendingGraphBannerView,
  getProcessingBannerView,
  isAwaitingGraphForCollection,
  isAwaitingGraphGeneration,
  isGraphViewable,
  isPipelineInProgress,
  isPipelineRunning,
  snapshotFromCollectionApi,
} from '../../lib/collection_processing'

// Estilos
import './buscador_coleccion.css'

const API_URL = import.meta.env.VITE_API_URL || ''

interface SearchResultItem {
  titulo: string
  fragmento: string
  id_chunk: string
  storage_path: string // <--- Cambio clave
  score: number
  pagina?: number
}

interface EntityFacet {
  id: string
  label: string
  tipo: string
}

interface CollectionEntities {
  tipos: string[]
  entidades: EntityFacet[]
}

// --- HELPER PARA HIGHLIGHT ---
function Highlight({ text, query }: { text: string; query: string }) {
  if (!query.trim()) return <>{text}</>
  const regex = new RegExp(
    `(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`,
    'gi',
  )
  const parts = text.split(regex)
  return (
    <>
      {parts.map((part, i) =>
        regex.test(part) ? (
          <mark key={i} className="bc-hl">
            {part}
          </mark>
        ) : (
          part
        ),
      )}
    </>
  )
}

const BuscadorColeccion = () => {
  const { id_usuario, id_coleccion } = useParams<{
    id_usuario: string
    id_coleccion: string
  }>()
  const { getAccessTokenSilently } = useAuth0()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const location = useLocation() // 🚀 NUEVO: Monitorea la ruta activa

  // Determina si el usuario está visualizando específicamente la ruta del grafo
  const isGrafoView = useMemo(
    () => location.pathname.endsWith('/grafo'),
    [location.pathname],
  )

  // --- ESTADOS ---
  const [nombreColeccion, setNombreColeccion] = useState('Cargando...')
  const [collectionProcessingStatus, setCollectionProcessingStatus] =
    useState('idle')
  const [fuentes, setFuentes] = useState([])
  const [resultados, setResultados] = useState<SearchResultItem[]>([])
  // --- NUEVOS ESTADOS DE PAGINACIÓN ---
  const [page, setPage] = useState(1);
  const [totalResults, setTotalResults] = useState(0);
  const [totalPages, setTotalPages] = useState(0);

  const [isEditingName, setIsEditingName] = useState(false)
  const [tempNombre, setTempNombre] = useState('')
  const [loading, setLoading] = useState(false)
  const [searchTime, setSearchTime] = useState<number>(0) // <-- NUEVO ESTADO

  const queryFromUrl = searchParams.get('q') ?? ''
  const [busqueda, setBusqueda] = useState(queryFromUrl)
  const [busquedaEnviada, setBusquedaEnviada] = useState(queryFromUrl)
  const [searchNotReadyMessage, setSearchNotReadyMessage] = useState<
    string | null
  >(null)

  // Modales
  const [modalCargaOpen, setModalCargaOpen] = useState(id_coleccion === 'nueva')
  const [modalPipelineEtapa, setModalPipelineEtapa] = useState(false)
  const [isEliminarModalOpen, setIsEliminarModalOpen] = useState(false)
  const [isDeletingCollection, setIsDeletingCollection] = useState(false)

  // --- NUEVOS ESTADOS PARA ENTIDADES ---
  const [entitiesData, setEntitiesData] = useState<CollectionEntities | null>(null);
  const [selectedEntityIds, setSelectedEntityIds] = useState<string[]>([]);

  const [isModalFuentesOpen, setIsModalFuentesOpen] = useState(false)
  const [isCollectionProcessing, setIsCollectionProcessing] = useState(false)
  const [backgroundProcessingId, setBackgroundProcessingId] = useState<
    string | null
  >(null)
  const [currentProcessingSnapshot, setCurrentProcessingSnapshot] =
    useState<CollectionProcessingSnapshot | null>(null)
  const [backgroundProcessingSnapshot, setBackgroundProcessingSnapshot] =
    useState<CollectionProcessingSnapshot | null>(null)

  // Filtros
  const [filtroOpen, setFiltroOpen] = useState(false)
  const [personas] = useState<string[]>([])
  const [fechaDesde] = useState('')
  const [fechaHasta] = useState('')
  

  const darkMode = window.matchMedia('(prefers-color-scheme: dark)').matches

  const [scopedCollectionId, setScopedCollectionId] = useState(id_coleccion)
  if (id_coleccion !== scopedCollectionId) {
    setScopedCollectionId(id_coleccion)
    setCurrentProcessingSnapshot(null)
    setIsCollectionProcessing(false)
    setCollectionProcessingStatus('idle')
    setBackgroundProcessingId(null)
    setBackgroundProcessingSnapshot(null)
  }

  useEffect(() => {
  if (collectionProcessingStatus === 'graph_ready' || collectionProcessingStatus === 'partial_error') {
    void cargarEntidades();
  }
}, [collectionProcessingStatus]);

  useEffect(() => {
    clearStaleActiveCollectionForPage(id_coleccion)
  }, [id_coleccion])

  useEffect(() => {
    const state = location.state as { abrirModalCarga?: boolean } | null
    if (!state?.abrirModalCarga) return

    queueMicrotask(() => {
      const isNueva = id_coleccion === 'nueva'
      if (id_coleccion && !isNueva) {
        localStorage.setItem(ACTIVE_COLLECTION_KEY, id_coleccion)
        localStorage.setItem(MODAL_ETAPA_KEY, 'pipeline')
        setModalPipelineEtapa(true)
      } else {
        setModalPipelineEtapa(false)
      }
      setModalCargaOpen(true)
      navigate(location.pathname, { replace: true, state: {} })
    })
  }, [location.pathname, location.state, navigate, id_coleccion])

  const redirectIfCollectionMissing = useCallback(() => {
    clearActiveCollectionStorageIfMatch(id_coleccion)
    setIsCollectionProcessing(false)
    setCurrentProcessingSnapshot(null)
    setCollectionProcessingStatus('idle')
    setBackgroundProcessingId(null)
    setBackgroundProcessingSnapshot(null)
    if (id_usuario) {
      navigate(`/landing-page/${id_usuario}`, { replace: true })
    }
  }, [id_coleccion, id_usuario, navigate])

  // --- CARGA DE DATOS INICIALES ---
  const cargarDatos = useCallback(async () => {
    if (!id_coleccion || id_coleccion === 'nueva') return

    try {
      const token = await getAccessTokenSilently()
      const headers = { Authorization: `Bearer ${token}` }

      const resColl = await fetch(
        `${API_URL}/api/collections/${id_coleccion}`,
        { headers },
      )
      if (resColl.status === 404) {
        redirectIfCollectionMissing()
        return
      }
      if (resColl.ok) {
        const data = await resColl.json()
        setNombreColeccion(data.name)
        setTempNombre(data.name)
        const status = data.processing_status ?? 'idle'
        setCollectionProcessingStatus(status)
        const processing = isPipelineInProgress(status)
        setIsCollectionProcessing(processing)
        if (processing) {
          setCurrentProcessingSnapshot(
            snapshotFromCollectionApi(data, id_coleccion),
          )
        } else {
          setCurrentProcessingSnapshot(null)
        }
      }

      if (isGrafoView) return

      const resDocs = await fetch(
        `${API_URL}/api/documentos?coleccion_id=${id_coleccion}`,
        { headers },
      )
      if (resDocs.ok) {
        setFuentes(await resDocs.json())
      }
    } catch (e) {
      console.error('Error cargando datos:', e)
    }
  }, [
    id_coleccion,
    isGrafoView,
    getAccessTokenSilently,
    redirectIfCollectionMissing,
  ])

  const isNuevaColeccionPage = id_coleccion === 'nueva'
  const shouldPollBackground = isNuevaColeccionPage && !modalCargaOpen

  const currentPageInPipeline = isPipelineInProgress(collectionProcessingStatus)

  // Polling ligero cuando el modal está cerrado y hay pipeline activo (solo en buscador).
  useEffect(() => {
    if (
      modalCargaOpen ||
      !id_coleccion ||
      id_coleccion === 'nueva' ||
      isGrafoView
    ) {
      return
    }

    let cancelled = false
    let intervalId: number | undefined

    const stopPolling = () => {
      cancelled = true
      if (intervalId !== undefined) {
        clearInterval(intervalId)
        intervalId = undefined
      }
    }

    const pollCollection = async (): Promise<boolean> => {
      try {
        const token = await getAccessTokenSilently()
        const res = await fetch(`${API_URL}/api/collections/${id_coleccion}`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (cancelled) return false
        if (res.status === 404) {
          redirectIfCollectionMissing()
          stopPolling()
          return false
        }
        if (!res.ok) return false
        const data = await res.json()
        const processing = isPipelineInProgress(data.processing_status)
        const esperandoGrafo = isAwaitingGraphForCollection(
          id_coleccion,
          data.processing_status,
        )
        setCollectionProcessingStatus(data.processing_status ?? 'idle')
        setIsCollectionProcessing(processing)
        if (processing) {
          setCurrentProcessingSnapshot(
            snapshotFromCollectionApi(data, id_coleccion),
          )
          if (isPipelineRunning(data.processing_status)) {
            localStorage.setItem(ACTIVE_COLLECTION_KEY, id_coleccion)
            localStorage.setItem(MODAL_ETAPA_KEY, 'pipeline')
          }
        } else {
          setCurrentProcessingSnapshot(null)
        }
        if (
          !processing &&
          localStorage.getItem(ACTIVE_COLLECTION_KEY) === id_coleccion &&
          !esperandoGrafo
        ) {
          localStorage.removeItem(ACTIVE_COLLECTION_KEY)
          localStorage.removeItem(MODAL_ETAPA_KEY)
        }
        return processing || esperandoGrafo
      } catch (e) {
        console.error('Error polling colección:', e)
        return false
      }
    }

    void (async () => {
      const keepPolling = await pollCollection()
      if (cancelled || !keepPolling) return
      intervalId = window.setInterval(async () => {
        const stillActive = await pollCollection()
        if (!stillActive) stopPolling()
      }, 3000)
    })()

    return () => stopPolling()
  }, [
    id_coleccion,
    modalCargaOpen,
    isGrafoView,
    getAccessTokenSilently,
    redirectIfCollectionMissing,
  ])

  // Barra de otra colección: solo en /nueva (nunca en la página de una colección concreta).
  useEffect(() => {
    if (!shouldPollBackground) return

    const trackedId = localStorage.getItem(ACTIVE_COLLECTION_KEY)
    if (!trackedId) return

    let cancelled = false
    let intervalId: number | undefined

    const stopPolling = () => {
      cancelled = true
      if (intervalId !== undefined) {
        clearInterval(intervalId)
        intervalId = undefined
      }
    }

    const pollBackground = async () => {
      try {
        const token = await getAccessTokenSilently()
        const res = await fetch(`${API_URL}/api/collections/${trackedId}`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (cancelled) return
        if (res.status === 404) {
          clearActiveCollectionStorageIfMatch(trackedId)
          setBackgroundProcessingId(null)
          setBackgroundProcessingSnapshot(null)
          stopPolling()
          return
        }
        if (!res.ok) return
        const data = await res.json()
        if (isPipelineInProgress(data.processing_status)) {
          setBackgroundProcessingId(trackedId)
          setBackgroundProcessingSnapshot(
            snapshotFromCollectionApi(data, trackedId),
          )
        } else if (
          isAwaitingGraphGeneration(data.processing_status) &&
          localStorage.getItem(MODAL_ETAPA_KEY) === 'pipeline'
        ) {
          setBackgroundProcessingId(trackedId)
          setBackgroundProcessingSnapshot(null)
        } else {
          localStorage.removeItem(ACTIVE_COLLECTION_KEY)
          localStorage.removeItem(MODAL_ETAPA_KEY)
          setBackgroundProcessingId(null)
          setBackgroundProcessingSnapshot(null)
          stopPolling()
        }
      } catch (e) {
        console.error('Error polling colección en background:', e)
      }
    }

    void pollBackground()
    intervalId = window.setInterval(pollBackground, 3000)
    return () => stopPolling()
  }, [shouldPollBackground, getAccessTokenSilently])

  const visibleBackgroundProcessingId = shouldPollBackground
    ? backgroundProcessingId
    : null
  const visibleBackgroundProcessingSnapshot = shouldPollBackground
    ? backgroundProcessingSnapshot
    : null

  const currentPagePipelineSnapshot = useMemo(() => {
    if (!id_coleccion || id_coleccion === 'nueva') return null
    if (currentProcessingSnapshot?.collectionId === id_coleccion) {
      return currentProcessingSnapshot
    }
    if (currentPageInPipeline) {
      return snapshotFromCollectionApi(
        {
          name: nombreColeccion,
          processing_status: collectionProcessingStatus,
        },
        id_coleccion,
      )
    }
    return null
  }, [
    id_coleccion,
    currentProcessingSnapshot,
    currentPageInPipeline,
    collectionProcessingStatus,
    nombreColeccion,
  ])

  const currentPipelineBannerView = useMemo(() => {
    if (!currentPagePipelineSnapshot) return null
    return getProcessingBannerView(currentPagePipelineSnapshot)
  }, [currentPagePipelineSnapshot])

  const otherPipelineBannerView = useMemo(() => {
    if (
      !isNuevaColeccionPage ||
      !visibleBackgroundProcessingSnapshot ||
      visibleBackgroundProcessingId === id_coleccion
    ) {
      return null
    }
    return getProcessingBannerView(visibleBackgroundProcessingSnapshot, {
      showCollectionName: true,
    })
  }, [
    isNuevaColeccionPage,
    visibleBackgroundProcessingSnapshot,
    visibleBackgroundProcessingId,
    id_coleccion,
  ])

  const openCollectionPipelineModal = () => {
    if (id_coleccion && id_coleccion !== 'nueva') {
      localStorage.setItem(ACTIVE_COLLECTION_KEY, id_coleccion)
      localStorage.setItem(MODAL_ETAPA_KEY, 'pipeline')
    }
    setModalPipelineEtapa(true)
    setModalCargaOpen(true)
  }

  const handleOpenCurrentCollectionModal = () => {
    openCollectionPipelineModal()
  }

  const handleOpenOtherCollection = () => {
    if (visibleBackgroundProcessingId && id_usuario) {
      localStorage.setItem(ACTIVE_COLLECTION_KEY, visibleBackgroundProcessingId)
      localStorage.setItem(MODAL_ETAPA_KEY, 'pipeline')
      navigate(
        `/${id_usuario}/colecciones/${visibleBackgroundProcessingId}/buscador`,
        {
          state: { abrirModalCarga: true },
        },
      )
    }
  }

  const pendingGraphBannerView = useMemo(() => {
    if (
      modalCargaOpen ||
      id_coleccion === 'nueva' ||
      currentPageInPipeline ||
      currentPipelineBannerView ||
      !isAwaitingGraphGeneration(collectionProcessingStatus) ||
      fuentes.length === 0 ||
      isCollectionProcessing
    ) {
      return null
    }
    return getPendingGraphBannerView(nombreColeccion)
  }, [
    modalCargaOpen,
    id_coleccion,
    currentPageInPipeline,
    currentPipelineBannerView,
    collectionProcessingStatus,
    fuentes.length,
    isCollectionProcessing,
    nombreColeccion,
  ])

  const cargarEntidades = useCallback(async () => {
    if (!id_coleccion || id_coleccion === 'nueva') return;

    try {
      const token = await getAccessTokenSilently();
      const res = await fetch(`${API_URL}/api/collections/${id_coleccion}/entities`, {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (res.ok) {
        const data: CollectionEntities = await res.json();
        setEntitiesData(data);
      }
    } catch (e) {
      console.error("Error al cargar entidades:", e);
    }
  }, [id_coleccion, getAccessTokenSilently]);

  const ejecutarBusqueda = useCallback(async (targetPage: number = 1) => {
    // Si estamos en modo grafo, no ejecutamos consultas semánticas de texto innecesarias
    if (
      !id_coleccion ||
      id_coleccion === 'nueva' ||
      !busquedaEnviada.trim() ||
      isGrafoView
    ) {
      if (!isGrafoView) setResultados([])
      return
    }

    setLoading(true)
    setSearchNotReadyMessage(null)
    try {
      const token = await getAccessTokenSilently()

      const searchRequest = {
        coleccion_id: id_coleccion,
        query: busquedaEnviada,
        page: targetPage,
        limit: 10,
        min_score: 0.25,
        entity_ids: selectedEntityIds,
        filtros:
          personas.length > 0 || fechaDesde || fechaHasta
            ? {
                tipo_entidad: personas.length > 0 ? personas[0] : null,
                rango_años:
                  fechaDesde || fechaHasta
                    ? [parseInt(fechaDesde) || 0, parseInt(fechaHasta) || 2026]
                    : null,
              }
            : null,
      }

      const startTime = performance.now() // <-- CAPTURAR TIEMPO INICIAL

      const res = await fetch(`${API_URL}/api/search`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(searchRequest),
      })

      const endTime = performance.now() // <-- CAPTURAR TIEMPO FINAL
      const durationSeconds = parseFloat(
        ((endTime - startTime) / 1000).toFixed(2),
      )

      if (res.ok) {
        const data = await res.json()
        if (data.ready === false) {
          setResultados([])
          setSearchNotReadyMessage(
            data.message ??
              'Aún no hay grafo generado. Genera el grafo para habilitar la búsqueda semántica.',
          )
        } else {
          setResultados(data.resultados || [])
          setSearchTime(durationSeconds) // <-- GUARDAR DURACIÓN EN SEGUNDOS
          setTotalResults(data.total)       
          setTotalPages(data.total_pages)
          setPage(data.page)
        }
      } else {
        setResultados([])
        setSearchTime(0)
      }
    } catch (e) {
      console.error('Error en búsqueda semántica:', e)
      setSearchTime(0)
    } finally {
      setLoading(false)
    }
  }, [
    id_coleccion,
    busquedaEnviada,
    selectedEntityIds,
    personas,
    fechaDesde,
    fechaHasta,
    isGrafoView,
    getAccessTokenSilently,
  ])

  useEffect(() => {
    const iniciarCarga = async () => {
      await cargarDatos()
    }

    void iniciarCarga()
  }, [cargarDatos])

  useEffect(() => {
    const timer = setTimeout(() => {
      // Ahora le pasamos la página 1 aquí para que coincida con la firma
      ejecutarBusqueda(1); 
    }, 400)
    return () => clearTimeout(timer)
}, [ejecutarBusqueda])

  // --- HANDLERS ---
  const handleBuscar = () => {
    const trimmed = busqueda.trim()
    setSearchParams(trimmed ? { q: trimmed } : {})
    setBusquedaEnviada(trimmed)
    setPage(1); // Reseteamos la página a 1 al hacer una nueva búsqueda
    ejecutarBusqueda(1); // Llamamos con página 1
}

  const saveNombre = async () => {
    if (tempNombre.trim() && id_coleccion && id_coleccion !== 'nueva') {
      try {
        const token = await getAccessTokenSilently()
        const res = await fetch(`${API_URL}/api/collections/${id_coleccion}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ name: tempNombre }),
        })
        if (res.ok) setNombreColeccion(tempNombre)
      } catch (e) {
        console.error(e)
      }
    }
    setIsEditingName(false)
  }

  const handleDelete = async () => {
    if (!id_coleccion || id_coleccion === 'nueva' || isDeletingCollection)
      return
    setIsDeletingCollection(true)
    try {
      const token = await getAccessTokenSilently()
      const res = await fetch(`${API_URL}/api/collections/${id_coleccion}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.status === 404 || res.ok) {
        clearActiveCollectionStorageIfMatch(id_coleccion)
        setIsCollectionProcessing(false)
        setCurrentProcessingSnapshot(null)
        setBackgroundProcessingId(null)
        setBackgroundProcessingSnapshot(null)
        setIsEliminarModalOpen(false)
        if (id_usuario) {
          navigate(`/landing-page/${id_usuario}`, { replace: true })
        }
        return
      }
      console.error('Error al eliminar colección:', res.status)
    } catch (e) {
      console.error(e)
    } finally {
      setIsDeletingCollection(false)
    }
  }

  const hayFiltrosActivos = personas.length > 0 || !!fechaDesde || !!fechaHasta

  // --- NUEVA LÓGICA DE URL FIRMADA ---
  const getSignedUrl = async (path: string) => {
    const token = await getAccessTokenSilently();
    const res = await fetch(`${API_URL}/api/documentos/signed-url?path=${encodeURIComponent(path)}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) throw new Error("Error obteniendo URL");
    const { url } = await res.json();
    return url;
  };

  const handleOpenDocument = async (path: string) => {
    try {
      const url = await getSignedUrl(path);
      window.open(url, '_blank');
    } catch (e) {
      console.error("No se pudo abrir el documento", e);
    }
  };

  return (
    <>
      <div className={`bc-root${darkMode ? ' bc-dark' : ''}`}>
        <aside className="bc-sidebar">
          <div className="bc-sidebar-inner">
            <div className="bc-sidebar-header">
              {isEditingName ? (
                <input
                  className="bc-sidebar-name-input"
                  value={tempNombre}
                  onChange={(e) => setTempNombre(e.target.value)}
                  onBlur={saveNombre}
                  onKeyDown={(e) => e.key === 'Enter' && saveNombre()}
                  autoFocus
                />
              ) : (
                <div
                  className="bc-sidebar-title-group"
                  onClick={() => setIsEditingName(true)}
                >
                  <h2 className="bc-sidebar-collection-name">
                    {nombreColeccion}
                  </h2>
                  <Edit2 size={12} className="bc-edit-icon" />
                </div>
              )}
              <span className="bc-sidebar-collection-label">
                Colección actual
              </span>
            </div>

            <div className="bc-sidebar-divider" />

            {/* 🔄 MODIFICACIÓN DE NAVEGACIÓN: Alterna inteligentemente entre vista de Texto y vista de Grafo */}
            {isGrafoView ? (
              <Link
                to={`/${id_usuario}/colecciones/${id_coleccion}/buscador`}
                className="bc-add-btn"
                style={{
                  textDecoration: 'none',
                  display: 'inline-flex',
                  alignItems: 'center',
                }}
              >
                <FileText size={15} />{' '}
                <span style={{ marginLeft: '4px' }}>Consultar Documentos</span>
              </Link>
            ) : id_coleccion !== 'nueva' ? (
              <Link
                to={`/${id_usuario}/colecciones/${id_coleccion}/grafo`}
                className="bc-add-btn"
                style={{
                  textDecoration: 'none',
                  display: 'inline-flex',
                  alignItems: 'center',
                }}
              >
                <Network size={15} />{' '}
                <span style={{ marginLeft: '4px' }}>Ver Grafo</span>
              </Link>
            ) : null}

            <button
              className="bc-add-btn"
              onClick={() => setIsModalFuentesOpen(true)}
            >
              <Files size={15} /> <span>Ver Documentos</span>
            </button>
            <button
              className="bc-delete-collection-btn"
              onClick={() => setIsEliminarModalOpen(true)}
            >
              <Trash2 size={14} /> <span>Borrar colección</span>
            </button>
          </div>
        </aside>

        <main className="bc-main">
          {/* FIX 2: banner de progreso en segundo plano */}
          {!modalCargaOpen && currentPipelineBannerView && (
            <div
              className="bc-alert-banner bc-processing-banner"
              style={{ cursor: 'pointer' }}
              onClick={handleOpenCurrentCollectionModal}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  handleOpenCurrentCollectionModal()
                }
              }}
            >
              <div className="bc-alert-content bc-processing-banner-main">
                <div className="bc-alert-icon-wrap">
                  <Loader2 size={14} className="bc-alert-icon bc-spin" />
                </div>
                <div className="bc-alert-text bc-processing-banner-text">
                  <span className="bc-alert-title">
                    {currentPipelineBannerView.title}
                  </span>
                  <p className="bc-alert-desc">
                    {currentPipelineBannerView.subtitle}
                  </p>
                  <div className="bc-processing-banner-progress-row">
                    <div
                      className={`bc-processing-banner-track${currentPipelineBannerView.progressPercent === null ? ' is-indeterminate' : ''}`}
                      aria-hidden
                    >
                      <div
                        className="bc-processing-banner-fill"
                        style={
                          currentPipelineBannerView.progressPercent !== null
                            ? {
                                width: `${currentPipelineBannerView.progressPercent}%`,
                              }
                            : undefined
                        }
                      />
                    </div>
                    <span className="bc-processing-banner-percent">
                      {currentPipelineBannerView.progressCaption}
                    </span>
                  </div>
                  <span className="bc-processing-banner-action">
                    Clic para ver detalle
                  </span>
                </div>
              </div>
            </div>
          )}
          {!modalCargaOpen && otherPipelineBannerView && (
            <div
              className="bc-alert-banner bc-processing-banner"
              style={{ cursor: 'pointer' }}
              onClick={handleOpenOtherCollection}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  handleOpenOtherCollection()
                }
              }}
            >
              <div className="bc-alert-content bc-processing-banner-main">
                <div className="bc-alert-icon-wrap">
                  <Loader2 size={14} className="bc-alert-icon bc-spin" />
                </div>
                <div className="bc-alert-text bc-processing-banner-text">
                  <span className="bc-alert-title">
                    {otherPipelineBannerView.title}
                  </span>
                  <p className="bc-alert-desc">
                    {otherPipelineBannerView.subtitle}
                  </p>
                  <div className="bc-processing-banner-progress-row">
                    <div
                      className={`bc-processing-banner-track${otherPipelineBannerView.progressPercent === null ? ' is-indeterminate' : ''}`}
                      aria-hidden
                    >
                      <div
                        className="bc-processing-banner-fill"
                        style={
                          otherPipelineBannerView.progressPercent !== null
                            ? {
                                width: `${otherPipelineBannerView.progressPercent}%`,
                              }
                            : undefined
                        }
                      />
                    </div>
                    <span className="bc-processing-banner-percent">
                      {otherPipelineBannerView.progressCaption}
                    </span>
                  </div>
                  <span className="bc-processing-banner-action">
                    Clic para ir a esa colección
                  </span>
                </div>
              </div>
            </div>
          )}
          {!modalCargaOpen && pendingGraphBannerView && (
            <div
              className="bc-alert-banner bc-processing-banner bc-pending-graph-banner"
              style={{ cursor: 'pointer' }}
              onClick={handleOpenCurrentCollectionModal}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  handleOpenCurrentCollectionModal()
                }
              }}
            >
              <div className="bc-alert-content bc-processing-banner-main">
                <div className="bc-alert-icon-wrap">
                  <Network size={14} className="bc-alert-icon" />
                </div>
                <div className="bc-alert-text bc-processing-banner-text">
                  <span className="bc-alert-title">
                    {pendingGraphBannerView.title}
                  </span>
                  <p className="bc-alert-desc">
                    {pendingGraphBannerView.subtitle}
                  </p>
                  <span className="bc-processing-banner-action">
                    {pendingGraphBannerView.actionLabel}
                  </span>
                </div>
              </div>
            </div>
          )}
          {/* 🚀 RENDERING CONDICIONAL CRÍTICO: Si la URL pide el grafo, renderiza la sub-ruta usando Outlet, sino muestra el buscador de texto tradicional */}
          {isGrafoView ? (
            <div
              style={{ width: '100%', height: '100%', position: 'relative' }}
            >
              <Outlet />
            </div>
          ) : (
            <>
              <div className="bc-searchbar-wrap">
                <div className="bc-searchbar">
                  <Search size={17} className="bc-searchbar-icon" />
                  <input
                    className="bc-searchbar-input"
                    placeholder="Consulta algo a tus documentos..."
                    value={busqueda}
                    onChange={(e) => setBusqueda(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleBuscar()}
                  />
                  <button
                    className={`bc-filter-btn ${filtroOpen ? 'active' : ''} ${hayFiltrosActivos ? 'has-filters' : ''}`}
                    onClick={() => setFiltroOpen(!filtroOpen)}
                  >
                    <SlidersHorizontal size={14} />{' '}
                    <span>Criterios de Búsqueda</span>
                  </button>
                </div>

                {filtroOpen && (
                <div className="bc-filter-panel">
                  {entitiesData?.tipos.map((tipo, index) => {
                    const entidadesDeTipo = entitiesData.entidades.filter(e => e.tipo === tipo);
                    const seleccionadasDeTipo = entidadesDeTipo.filter(e => selectedEntityIds?.includes(e.id));

                    return (
                      <div key={tipo}>
                        {index > 0 && <div className="bc-filter-divider" />}
                        <div className="bc-filter-group">
                          <span className="bc-filter-label">{tipo}</span>

                          <select
                            value=""
                            onChange={(e) => {
                              const val = e.target.value;
                              if (!val) return;
                              setSelectedEntityIds(prev =>
                                prev?.includes(val) ? prev : [...(prev ?? []), val]
                              );
                            }}
                            className="bc-filter-tag-input"
                          >
                            <option value="">Agregar {tipo}…</option>
                            {entidadesDeTipo
                              .filter(entidad => !selectedEntityIds?.includes(entidad.id))
                              .map(entidad => (
                                <option key={entidad.id} value={entidad.id}>{entidad.label}</option>
                              ))
                            }
                          </select>

                          {seleccionadasDeTipo.length > 0 && (
                            <div className="bc-filter-chips">
                              {seleccionadasDeTipo.map(entidad => (
                                <span key={entidad.id} className="bc-filter-chip selected">
                                  {entidad.label}
                                  <button
                                    className="bc-chip-remove"
                                    onClick={() => setSelectedEntityIds(prev => prev?.filter(id => id !== entidad.id) ?? [])}
                                  >
                                    ×
                                  </button>
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}

                  {selectedEntityIds && selectedEntityIds.length > 0 && (
                    <button className="bc-filter-clear-all" onClick={() => setSelectedEntityIds([])}>
                      Limpiar filtros
                    </button>
                  )}
                </div>
                )}
                              </div>

              <div className="bc-results-area">
                {loading ? (
                  <div className="bc-empty">
                    <Loader2 className="bc-spin" size={30} />
                    <p>Consultando el grafo de conocimiento...</p>
                  </div>
                ) : resultados.length > 0 ? (
                  <>
                    <div className="bc-results-meta">
                      <span className="bc-results-count">
                        {/* Cambiamos resultados.length por totalResults */}
                        {totalResults} resultado{totalResults !== 1 ? 's' : ''} encontrados
                        {searchTime > 0 && ` en ${searchTime}s`}
                      </span>
                    </div>
                    <div className="bc-results-list">
                      {resultados.map((r, idx) => (
                        <article key={idx} className="bc-result-card">
                          <div className="bc-card-header">
                            <div className="bc-header-info">
                              <div className="bc-title-row">
                                <FileText size={14} className="bc-doc-icon" />
                                <h3 className="bc-result-title">{r.titulo}</h3>
                              </div>

                              <div
                                className={`bc-score-status ${r.score > 0.7 ? 'status-high' : r.score > 0.4 ? 'status-med' : 'status-low'}`}
                              >
                                <CheckCircle2
                                  size={12}
                                  className="bc-status-icon"
                                />
                                <span className="bc-score-value">
                                  {(r.score * 100).toFixed(0)}% de coincidencia
                                </span>
                              </div>
                            </div>

                            <button 
                              onClick={() => handleOpenDocument(r.storage_path)}
                              className="bc-external-btn"
                            >
                              <ExternalLink size={13} />
                              <span>Ver Documento</span>
                            </button>
                          </div>

                          <div className="bc-card-body">
                            <p className="bc-result-excerpt">
                              <Highlight
                                text={r.fragmento}
                                query={busquedaEnviada}
                              />
                            </p>
                          </div>

                          <div className="bc-card-footer">
                            <div className="bc-footer-tag">
                              <Network size={12} />
                              <span>Grafo IMFD</span>
                            </div>
                            {r.pagina && (
                              <div className="bc-footer-tag">
                                <span>Página {r.pagina}</span>
                              </div>
                            )}
                          </div>
                        </article>
                      ))}
                    </div>
                    {totalPages > 1 && (
                      <div className="bc-pagination">
                        <button disabled={page === 1} onClick={() => ejecutarBusqueda(page - 1)}>Anterior</button>
                        <span>Página {page} de {totalPages}</span>
                        <button disabled={page === totalPages} onClick={() => ejecutarBusqueda(page + 1)}>Siguiente</button>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="bc-empty">
                    <div className="bc-empty-icon">
                      <Search size={30} />
                    </div>
                    <h3 className="bc-empty-title">
                      {searchNotReadyMessage
                        ? 'Búsqueda no disponible aún'
                        : 'Sin resultados todavía'}
                    </h3>
                    <p className="bc-empty-sub">
                      {searchNotReadyMessage ??
                        (busquedaEnviada
                          ? 'No hay fragmentos que coincidan con tu búsqueda semántica.'
                          : !isGraphViewable(collectionProcessingStatus)
                            ? 'Genera el grafo de la colección para habilitar la búsqueda semántica.'
                            : 'Haz una consulta para explorar los documentos de esta colección.')}
                    </p>
                  </div>
                )}
              </div>
            </>
          )}
        </main>
      </div>

      <ModalCarga
        key={
          id_coleccion === 'nueva'
            ? `nueva-${modalCargaOpen ? 'open' : 'closed'}`
            : (id_coleccion ?? 'none')
        }
        isOpen={modalCargaOpen}
        scopeCollectionId={id_coleccion ?? null}
        scopeUserId={id_usuario ?? null}
        forcePipelineEtapa={modalPipelineEtapa}
        onClose={() => {
          setModalCargaOpen(false)
          setModalPipelineEtapa(false)
          if (isNuevaColeccionPage) {
            const tracked = localStorage.getItem(ACTIVE_COLLECTION_KEY)
            setBackgroundProcessingId(tracked)
          }
        }}
        onProcessingChange={setIsCollectionProcessing}
        onUploadSuccess={cargarDatos}
        darkMode={darkMode}
      />

      <ModalEliminarColeccion
        isOpen={isEliminarModalOpen}
        onClose={() => {
          if (!isDeletingCollection) setIsEliminarModalOpen(false)
        }}
        onConfirm={handleDelete}
        nombreColeccion={nombreColeccion}
        isConfirming={isDeletingCollection}
      />

      <ModalDocumentosDisponibles
        isOpen={isModalFuentesOpen}
        fuentes={fuentes}
        onClose={() => setIsModalFuentesOpen(false)}
        darkMode={darkMode}
      />
    </>
  )
}

export default BuscadorColeccion
