import {
  useState,
  useEffect,
  useCallback,
  useMemo,
  type KeyboardEvent,
} from 'react'
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
  ChevronRight,
  HelpCircle,
} from 'lucide-react'
import { Link } from 'react-router-dom'

// Componentes
import ModalCarga from '../../components/modal_carga/modal_carga'
import ModalEliminarColeccion from '../../components/modal_eliminar_coleccion/modal_eliminar_coleccion'
import ModalRenombrarColeccion from '../../components/modal_renombrar_coleccion/modal_renombrar_coleccion'
import ModalDocumentosDisponibles from '../../components/modal_documentos_disponibles/modal_documentos_disponibles'
import ModalFiltros from '../../components/modal_filtro/modal_filtro'

import {
  ACTIVE_COLLECTION_KEY,
  MODAL_ETAPA_KEY,
  MODAL_NUEVA_SESSION_KEY,
  type CollectionProcessingSnapshot,
  clearActiveCollectionStorageIfMatch,
  clearStaleActiveCollectionForPage,
  getPendingGraphBannerView,
  getProcessingBannerView,
  hasPipelineModalIntent,
  isAwaitingGraphForCollection,
  isAwaitingGraphGeneration,
  isGraphViewable,
  isPipelineInProgress,
  isPipelineRunning,
  shouldOpenPipelineModal,
  snapshotFromCollectionApi,
} from '../../lib/collection_processing'

import {
  buildBuscadorSearchParams,
  readBuscadorFiltersFromSearchParams,
} from '../../lib/buscador_search_params'

import './buscador_coleccion.css'

const API_URL = import.meta.env.VITE_API_URL || ''

function readInitialModalState(collectionId: string | undefined) {
  if (!collectionId || typeof window === 'undefined') {
    return { open: false, pipeline: false }
  }

  if (collectionId === 'nueva') {
    const pipeline =
      localStorage.getItem(MODAL_NUEVA_SESSION_KEY) === '1' &&
      localStorage.getItem(MODAL_ETAPA_KEY) === 'pipeline' &&
      !!localStorage.getItem(ACTIVE_COLLECTION_KEY)
    return { open: true, pipeline }
  }

  const pipeline = hasPipelineModalIntent(collectionId)
  return { open: pipeline, pipeline }
}

const SEARCH_SEMANTIC_HELP =
  'La búsqueda semántica interpreta el significado de tu consulta, no solo palabras exactas. Encuentra fragmentos relacionados aunque no repitan tu texto.'

const SEARCH_SEMANTIC_HELP_HINT =
  'Pasa el cursor sobre (?) para saber qué es la búsqueda semántica.'

function getMatchLevel(score: number) {
  if (score > 0.7) {
    return {
      label: 'Alta coincidencia',
      hint: 'Muy relacionado con tu consulta.',
      statusClass: 'status-high',
    }
  }
  if (score > 0.4) {
    return {
      label: 'Coincidencia media',
      hint: 'Relacionado en parte con tu consulta.',
      statusClass: 'status-med',
    }
  }
  return {
    label: 'Coincidencia baja',
    hint: 'Relación débil; puede ser útil revisarlo.',
    statusClass: 'status-low',
  }
}

// ============================================
// TIPOS
// ============================================

interface SearchResultItem {
  titulo: string
  fragmento: string
  id_chunk: string
  storage_path: string
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

// ============================================
// COMPONENTE HELPER: HIGHLIGHT
// ============================================

function Highlight({ text, queries }: { text: string; queries: string[] }) {
  const terms = queries.filter((q) => q && q.trim())
  if (terms.length === 0) return <>{text}</>

  const escaped = terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const regex = new RegExp(`(${escaped.join('|')})`, 'gi')
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

type ProcessingStatusBannerProps = {
  title: string
  subtitle: string
  actionLabel: string
  onActivate: () => void
  progressPercent?: number | null
  progressCaption?: string
  pendingGraph?: boolean
}

function ProcessingStatusBanner({
  title,
  subtitle,
  actionLabel,
  onActivate,
  progressPercent = null,
  progressCaption,
  pendingGraph = false,
}: ProcessingStatusBannerProps) {
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onActivate()
    }
  }

  return (
    <div
      className={`bc-processing-banner${pendingGraph ? ' bc-processing-banner-pending' : ''}`}
      onClick={onActivate}
      onKeyDown={handleKeyDown}
      role="button"
      tabIndex={0}
      aria-label={`${title}. ${actionLabel}`}
    >
      <div className="bc-processing-banner-accent" aria-hidden />
      <div className="bc-processing-banner-body">
        <div className="bc-processing-banner-top">
          <div className="bc-processing-banner-icon">
            {pendingGraph ? (
              <Network size={16} aria-hidden />
            ) : (
              <Loader2 size={16} className="bc-spin" aria-hidden />
            )}
          </div>
          <div className="bc-processing-banner-meta">
            <span className="bc-processing-banner-title">{title}</span>
            <p className="bc-processing-banner-desc">{subtitle}</p>
          </div>
          <span className="bc-processing-banner-cta">
            {actionLabel}
            <ChevronRight size={14} aria-hidden />
          </span>
        </div>

        {!pendingGraph && (
          <div className="bc-processing-banner-progress-row">
            <div
              className={
                progressPercent === null
                  ? 'bc-processing-banner-track is-indeterminate'
                  : 'bc-processing-banner-track'
              }
              aria-hidden
            >
              <div
                className="bc-processing-banner-fill"
                style={
                  progressPercent !== null
                    ? { width: `${progressPercent}%` }
                    : undefined
                }
              />
            </div>
            {progressCaption && (
              <span className="bc-processing-banner-percent">
                {progressCaption}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ============================================
// COMPONENTE PRINCIPAL
// ============================================

const BuscadorColeccion = () => {
  // ─────────────────────────────────────────
  // 1. CONTEXTO & HOOKS DE ROUTING
  // ─────────────────────────────────────────

  const { id_usuario, id_coleccion } = useParams<{
    id_usuario: string
    id_coleccion: string
  }>()
  const { getAccessTokenSilently } = useAuth0()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const location = useLocation()
  const initialUrlFilters = readBuscadorFiltersFromSearchParams(searchParams)

  // ─────────────────────────────────────────
  // 2. DERIVED STATE: RUTAS
  // ─────────────────────────────────────────

  const isGrafoView = useMemo(
    () => location.pathname.endsWith('/grafo'),
    [location.pathname],
  )
  const isNuevaColeccionPage = id_coleccion === 'nueva'

  // ─────────────────────────────────────────
  // 3. ESTADO: COLECCIÓN
  // ─────────────────────────────────────────

  const [nombreColeccion, setNombreColeccion] = useState('Cargando...')
  const [collectionProcessingStatus, setCollectionProcessingStatus] =
    useState('idle')
  const [isCollectionProcessing, setIsCollectionProcessing] = useState(false)
  const [currentProcessingSnapshot, setCurrentProcessingSnapshot] =
    useState<CollectionProcessingSnapshot | null>(null)
  const [scopedCollectionId, setScopedCollectionId] = useState(id_coleccion)

  // ─────────────────────────────────────────
  // 4. ESTADO: BÚSQUEDA
  // ─────────────────────────────────────────

  const queryFromUrl = initialUrlFilters.q
  const [busqueda, setBusqueda] = useState(queryFromUrl)
  const [busquedaEnviada, setBusquedaEnviada] = useState(queryFromUrl)
  const [resultados, setResultados] = useState<SearchResultItem[]>([])
  const [loading, setLoading] = useState(false)
  const [searchTime, setSearchTime] = useState<number>(0)
  const [searchNotReadyMessage] = useState<string | null>(null)
  const [page, setPage] = useState<number>(initialUrlFilters.page)
  const [totalResults, setTotalResults] = useState(0)
  const [totalPages, setTotalPages] = useState(0)

  // ─────────────────────────────────────────
  // 5. ESTADO: FILTROS & ENTIDADES
  // ─────────────────────────────────────────

  const [entidades, setEntidades] = useState<EntityFacet[]>([])
  const [tiposEntidad, setTiposEntidad] = useState<string[]>([])
  const [entidadesSeleccionadas, setEntidadesSeleccionadas] = useState<
    string[]
  >(initialUrlFilters.entities)
  const [logicaEntidades, setLogicaEntidades] = useState<'OR' | 'AND'>(
    initialUrlFilters.entityLogic,
  )
  const [tipoFiltroUI, setTipoFiltroUI] = useState<string | null>(
    initialUrlFilters.entityType,
  )
  const [entitySearch, setEntitySearch] = useState('')
  const [filtroOpen, setFiltroOpen] = useState(false)
  const [semanticHelpActive, setSemanticHelpActive] = useState(false)

  // ─────────────────────────────────────────
  // 6. ESTADO: DOCUMENTOS
  // ─────────────────────────────────────────

  const [fuentes, setFuentes] = useState([])

  // ─────────────────────────────────────────
  // 7. ESTADO: FILTROS
  // ─────────────────────────────────────────

  const [fechaDesde] = useState('')
  const [fechaHasta] = useState('')

  // ─────────────────────────────────────────
  // 8. ESTADO: MODALES
  // ─────────────────────────────────────────

  const initialModalState = readInitialModalState(id_coleccion)

  const [modalCargaOpen, setModalCargaOpen] = useState(initialModalState.open)
  const [modalPipelineEtapa, setModalPipelineEtapa] = useState(
    initialModalState.pipeline,
  )
  const [isModalFuentesOpen, setIsModalFuentesOpen] = useState(false)
  const [isEliminarModalOpen, setIsEliminarModalOpen] = useState(false)
  const [isRenombrarModalOpen, setIsRenombrarModalOpen] = useState(false)
  const [guardandoNombre, setGuardandoNombre] = useState(false)
  const [isDeletingCollection, setIsDeletingCollection] = useState(false)

  // ─────────────────────────────────────────
  // 9. ESTADO: BACKGROUND PROCESSING
  // ─────────────────────────────────────────

  const [backgroundProcessingId, setBackgroundProcessingId] = useState<
    string | null
  >(null)
  const [backgroundProcessingSnapshot, setBackgroundProcessingSnapshot] =
    useState<CollectionProcessingSnapshot | null>(null)

  // ─────────────────────────────────────────
  // 10. SINCRONIZACIÓN CUANDO CAMBIA LA COLECCIÓN (DESPUÉS DE TODOS LOS ESTADOS)
  // ─────────────────────────────────────────

  if (id_coleccion !== scopedCollectionId) {
    setScopedCollectionId(id_coleccion)
    setCurrentProcessingSnapshot(null)
    setIsCollectionProcessing(false)
    setCollectionProcessingStatus('idle')
    setBackgroundProcessingId(null)
    setBackgroundProcessingSnapshot(null)
  }

  // ─────────────────────────────────────────
  // 11. DERIVED STATE: POLLING & VISIBILITY
  // ─────────────────────────────────────────

  const shouldPollBackground = isNuevaColeccionPage && !modalCargaOpen
  const currentPageInPipeline = isPipelineInProgress(collectionProcessingStatus)

  const visibleBackgroundProcessingId = shouldPollBackground
    ? backgroundProcessingId
    : null
  const visibleBackgroundProcessingSnapshot = shouldPollBackground
    ? backgroundProcessingSnapshot
    : null

  // ─────────────────────────────────────────
  // 12. TEMA & CONFIGURACIÓN
  // ─────────────────────────────────────────

  const darkMode =
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches

  // ─────────────────────────────────────────
  // 13. COMPUTED: FILTROS
  // ─────────────────────────────────────────

  const entidadesFiltradas = useMemo(
    () =>
      entidades.filter((e) => {
        const matchTipo = tipoFiltroUI === null || e.tipo === tipoFiltroUI
        const matchSearch =
          !entitySearch.trim() ||
          e.label.toLowerCase().includes(entitySearch.toLowerCase())
        return matchTipo && matchSearch
      }),
    [entidades, tipoFiltroUI, entitySearch],
  )

  const hayFiltrosActivos =
    entidadesSeleccionadas.length > 0 || !!fechaDesde || !!fechaHasta

  const sidebarCollectionName = isNuevaColeccionPage
    ? 'Nueva Colección'
    : nombreColeccion
  const canEditCollectionName =
    !isNuevaColeccionPage && id_coleccion !== 'nueva'
  const canDeleteCollection = !isNuevaColeccionPage && id_coleccion !== 'nueva'
  const isSearchDisabled = isNuevaColeccionPage
  const isNuevaBackgroundProcessing =
    isNuevaColeccionPage && !modalCargaOpen && !!visibleBackgroundProcessingId
  const showNuevaOnboarding =
    isNuevaColeccionPage && !modalCargaOpen && !isNuevaBackgroundProcessing

  const handleOpenAddSources = () => {
    setModalPipelineEtapa(false)
    setModalCargaOpen(true)
  }
  // ─────────────────────────────────────────

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

  const cargarEntidades = useCallback(async () => {
    if (!id_coleccion || id_coleccion === 'nueva') return

    try {
      const token = await getAccessTokenSilently()
      const res = await fetch(
        `${API_URL}/api/collections/${id_coleccion}/entities`,
        { headers: { Authorization: `Bearer ${token}` } },
      )

      if (res.ok) {
        const data: CollectionEntities = await res.json()
        setEntidades(data.entidades || [])
        setTiposEntidad(data.tipos || [])
      }
    } catch (e) {
      console.error('Error al cargar entidades:', e)
    }
  }, [id_coleccion, getAccessTokenSilently])

  const cargarDatos = useCallback(async () => {
    if (!id_coleccion || id_coleccion === 'nueva') return

    const shouldRestoreModalOnLoad = hasPipelineModalIntent(id_coleccion)

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
      let collectionStatus = 'idle'
      if (resColl.ok) {
        const data = await resColl.json()
        setNombreColeccion(data.name)
        collectionStatus = data.processing_status ?? 'idle'
        setCollectionProcessingStatus(collectionStatus)
        const processing = isPipelineInProgress(collectionStatus)
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
      let documentCount = 0
      if (resDocs.ok) {
        const docs = await resDocs.json()
        setFuentes(docs)
        documentCount = Array.isArray(docs) ? docs.length : 0
      }

      if (
        shouldRestoreModalOnLoad &&
        shouldOpenPipelineModal(collectionStatus, {
          savedModalEtapa: 'pipeline',
          documentCount,
        })
      ) {
        localStorage.setItem(ACTIVE_COLLECTION_KEY, id_coleccion)
        localStorage.setItem(MODAL_ETAPA_KEY, 'pipeline')
        setModalPipelineEtapa(true)
        setModalCargaOpen(true)
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

  // ─────────────────────────────────────────
  // 15. CALLBACKS: BÚSQUEDA
  // ─────────────────────────────────────────

  const ejecutarBusqueda = useCallback(async () => {
    const tieneQuery = busquedaEnviada.trim().length > 0
    const tieneEntidades = entidadesSeleccionadas.length > 0

    if (!tieneQuery && !tieneEntidades) {
      setResultados([])
      setTotalResults(0)
      setTotalPages(0)
      setSearchTime(0)
      return
    }

    setLoading(true)
    const startTime = performance.now() // ← Inicia el cronómetro

    try {
      const token = await getAccessTokenSilently()

      const searchRequest = {
        coleccion_id: id_coleccion,
        query: busquedaEnviada.trim() || undefined,
        min_score: 0.25,
        page: page,
        filtros:
          entidadesSeleccionadas.length > 0 || fechaDesde || fechaHasta
            ? {
                nombres_entidades:
                  entidadesSeleccionadas.length > 0
                    ? entidadesSeleccionadas
                    : null,
                logica_entidades: logicaEntidades,
                rango_años:
                  fechaDesde || fechaHasta
                    ? [parseInt(fechaDesde) || 0, parseInt(fechaHasta) || 2026]
                    : null,
              }
            : null,
      }

      const res = await fetch(`${API_URL}/api/search`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(searchRequest),
      })

      if (!res.ok) throw new Error('Error en la búsqueda')
      const data = await res.json()

      // Calcula el tiempo transcurrido en segundos
      const endTime = performance.now()
      const elapsedSeconds = (endTime - startTime) / 1000

      // Asegurarse de que los datos se asignan correctamente
      setResultados(Array.isArray(data.resultados) ? data.resultados : [])
      setTotalResults(typeof data.total === 'number' ? data.total : 0)
      setTotalPages(typeof data.total_pages === 'number' ? data.total_pages : 1)
      setSearchTime(elapsedSeconds)

      console.log('Búsqueda completada:', {
        resultados: data.resultados?.length,
        total: data.total,
        pages: data.pages,
        tiempo_segundos: elapsedSeconds.toFixed(2),
      })
    } catch (error) {
      console.error('Error en búsqueda:', error)
      setResultados([])
      setTotalResults(0)
      setTotalPages(0)
      setSearchTime(0)
    } finally {
      setLoading(false)
    }
  }, [
    id_coleccion,
    busquedaEnviada,
    entidadesSeleccionadas,
    logicaEntidades,
    fechaDesde,
    fechaHasta,
    page,
    getAccessTokenSilently,
  ])

  // ─────────────────────────────────────────
  // 16. CALLBACKS: EDICIÓN & ELIMINACIÓN
  // ─────────────────────────────────────────

  const confirmarRenombrar = async (nuevoNombre: string) => {
    if (!id_coleccion || id_coleccion === 'nueva' || guardandoNombre) return

    setGuardandoNombre(true)
    try {
      const token = await getAccessTokenSilently()
      const res = await fetch(`${API_URL}/api/collections/${id_coleccion}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ name: nuevoNombre }),
      })
      if (res.ok) {
        setNombreColeccion(nuevoNombre)
        setIsRenombrarModalOpen(false)
      }
    } catch (e) {
      console.error(e)
    } finally {
      setGuardandoNombre(false)
    }
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

  // ─────────────────────────────────────────
  // 17. CALLBACKS: DOCUMENTOS
  // ─────────────────────────────────────────

  const getSignedUrl = async (path: string) => {
    const token = await getAccessTokenSilently()
    const res = await fetch(
      `${API_URL}/api/documentos/signed-url?path=${encodeURIComponent(path)}`,
      { headers: { Authorization: `Bearer ${token}` } },
    )
    if (!res.ok) throw new Error('Error obteniendo URL')
    const { url } = await res.json()
    return url
  }

  const handleOpenDocument = async (path: string) => {
    try {
      const url = await getSignedUrl(path)
      window.open(url, '_blank')
    } catch (e) {
      console.error('No se pudo abrir el documento', e)
    }
  }

  // ─────────────────────────────────────────
  // 18. CALLBACKS: FILTROS & ENTIDADES
  // ─────────────────────────────────────────

  const toggleEntidad = (label: string) => {
    setEntidadesSeleccionadas((prev) =>
      prev.includes(label) ? prev.filter((n) => n !== label) : [...prev, label],
    )
  }

  const handleBuscar = () => {
    const trimmed = busqueda.trim()
    setBusquedaEnviada(trimmed)
    setPage(1)
  }

  const syncSearchParamsToUrl = useCallback(() => {
    setSearchParams(
      buildBuscadorSearchParams({
        q: busquedaEnviada,
        entities: entidadesSeleccionadas,
        entityLogic: logicaEntidades,
        entityType: tipoFiltroUI,
        page,
      }),
      { replace: true },
    )
  }, [
    busquedaEnviada,
    entidadesSeleccionadas,
    logicaEntidades,
    tipoFiltroUI,
    page,
    setSearchParams,
  ])

  // ─────────────────────────────────────────
  // 19. CALLBACKS: MODALES
  // ─────────────────────────────────────────

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
        { state: { abrirModalCarga: true } },
      )
    }
  }

  // ─────────────────────────────────────────
  // 20. EFFECTS: SINCRONIZACIÓN DE URL
  // ─────────────────────────────────────────

  useEffect(() => {
    syncSearchParamsToUrl()
  }, [syncSearchParamsToUrl])

  useEffect(() => {
    clearStaleActiveCollectionForPage(id_coleccion)
  }, [id_coleccion])

  // ─────────────────────────────────────────
  // 21. EFFECTS: CARGA INICIAL
  // ─────────────────────────────────────────

  useEffect(() => {
    const iniciarCarga = async () => {
      await cargarDatos()
    }
    void iniciarCarga()
  }, [cargarDatos])

  // ─────────────────────────────────────────
  // 22. EFFECTS: ESTADO DE MODALES
  // ─────────────────────────────────────────

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

  // ─────────────────────────────────────────
  // 23. EFFECTS: CARGA DE ENTIDADES
  // ─────────────────────────────────────────

  useEffect(() => {
    if (
      collectionProcessingStatus === 'graph_ready' ||
      collectionProcessingStatus === 'partial_error'
    ) {
      setTimeout(() => {
        void cargarEntidades()
      }, 0)
    }
  }, [collectionProcessingStatus, cargarEntidades])

  useEffect(() => {
    if (!id_coleccion || id_coleccion === 'nueva') return

    const estaLista =
      collectionProcessingStatus === 'graph_ready' ||
      collectionProcessingStatus === 'partial_error'
    if (!estaLista) return

    const fetchEntities = async () => {
      try {
        const token = await getAccessTokenSilently()
        const res = await fetch(
          `${API_URL}/api/collections/${id_coleccion}/entities`,
          { headers: { Authorization: `Bearer ${token}` } },
        )
        if (res.ok) {
          const data = await res.json()
          setEntidades(data.entidades || [])
          setTiposEntidad(data.tipos || [])
        }
      } catch (e) {
        console.error('Error cargando entidades:', e)
      }
    }

    void fetchEntities()
  }, [id_coleccion, collectionProcessingStatus, getAccessTokenSilently])

  // ─────────────────────────────────────────
  // 24. EFFECTS: BÚSQUEDA CON DEBOUNCE
  // ─────────────────────────────────────────

  useEffect(() => {
    const timer = setTimeout(() => {
      ejecutarBusqueda()
    }, 400)
    return () => clearTimeout(timer)
  }, [ejecutarBusqueda, page])

  // ─────────────────────────────────────────
  // 25. EFFECTS: POLLING COLECCIÓN ACTUAL
  // ─────────────────────────────────────────

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

  // ─────────────────────────────────────────
  // 26. EFFECTS: POLLING DE BACKGROUND
  // ─────────────────────────────────────────

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

  // ─────────────────────────────────────────
  // 27. COMPUTED: SNAPSHOTS PIPELINE
  // ─────────────────────────────────────────

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
    return getProcessingBannerView(currentPagePipelineSnapshot, {
      showCollectionName: false,
    })
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

  // ============================================
  // RENDER
  // ============================================

  return (
    <>
      <div className={darkMode ? 'bc-root bc-dark' : 'bc-root'}>
        {/* ──────────────────────────────────── */}
        {/* SIDEBAR */}
        {/* ──────────────────────────────────── */}

        <aside className="bc-sidebar">
          <div className="bc-sidebar-inner">
            <div className="bc-sidebar-header">
              <div className="bc-sidebar-title-group">
                <h2 className="bc-sidebar-collection-name">
                  {sidebarCollectionName}
                </h2>
                {canEditCollectionName && (
                  <button
                    type="button"
                    className="bc-edit-name-btn"
                    onClick={() => setIsRenombrarModalOpen(true)}
                    aria-label="Renombrar colección"
                  >
                    <Edit2 size={16} strokeWidth={1.75} aria-hidden />
                  </button>
                )}
              </div>
            </div>

            <div className="bc-sidebar-divider" />

            {isGrafoView ? (
              <Link
                to={`/${id_usuario}/colecciones/${id_coleccion}/buscador`}
                className="bc-add-btn bc-add-btn-link"
              >
                <FileText size={15} />
                <span>Consultar Documentos</span>
              </Link>
            ) : id_coleccion !== 'nueva' ? (
              <Link
                to={`/${id_usuario}/colecciones/${id_coleccion}/grafo`}
                className="bc-add-btn bc-add-btn-link"
              >
                <Network size={15} />
                <span>Ver Grafo</span>
              </Link>
            ) : null}

            <button
              type="button"
              className="bc-add-btn bc-add-btn-secondary"
              onClick={() => setIsModalFuentesOpen(true)}
              disabled={isNuevaColeccionPage}
              title={
                isNuevaColeccionPage
                  ? 'Sube documentos primero para ver la lista'
                  : undefined
              }
            >
              <Files size={15} /> <span>Ver Documentos</span>
            </button>

            {canDeleteCollection && (
              <button
                type="button"
                className="bc-delete-collection-btn"
                onClick={() => setIsEliminarModalOpen(true)}
              >
                <Trash2 size={14} /> <span>Borrar Colección</span>
              </button>
            )}
          </div>
        </aside>

        {/* ──────────────────────────────────── */}
        {/* MAIN CONTENT */}
        {/* ──────────────────────────────────── */}

        <main className="bc-main">
          {/* BANNERS DE PROGRESO */}

          {!modalCargaOpen && currentPipelineBannerView && (
            <ProcessingStatusBanner
              title={currentPipelineBannerView.title}
              subtitle={currentPipelineBannerView.subtitle}
              progressPercent={currentPipelineBannerView.progressPercent}
              progressCaption={currentPipelineBannerView.progressCaption}
              actionLabel="Ver detalle"
              onActivate={handleOpenCurrentCollectionModal}
            />
          )}

          {!modalCargaOpen && otherPipelineBannerView && (
            <ProcessingStatusBanner
              title={otherPipelineBannerView.title}
              subtitle={otherPipelineBannerView.subtitle}
              progressPercent={otherPipelineBannerView.progressPercent}
              progressCaption={otherPipelineBannerView.progressCaption}
              actionLabel="Ir a colección"
              onActivate={handleOpenOtherCollection}
            />
          )}

          {!modalCargaOpen && pendingGraphBannerView && (
            <ProcessingStatusBanner
              title={pendingGraphBannerView.title}
              subtitle={pendingGraphBannerView.subtitle}
              actionLabel={pendingGraphBannerView.actionLabel}
              onActivate={handleOpenCurrentCollectionModal}
              pendingGraph
            />
          )}

          {/* CONTENIDO PRINCIPAL */}

          {isGrafoView ? (
            <div
              style={{ width: '100%', height: '100%', position: 'relative' }}
            >
              <Outlet />
            </div>
          ) : (
            <div className="bc-main-scroll">
              {/* BARRA DE BÚSQUEDA */}

              <div
                className={`bc-searchbar-wrap${isSearchDisabled ? ' is-disabled' : ''}`}
              >
                <div className="bc-searchbar">
                  <Search size={17} className="bc-searchbar-icon" />
                  <input
                    className="bc-searchbar-input"
                    placeholder={
                      isSearchDisabled
                        ? 'Disponible cuando la colección esté creada'
                        : 'Consulta algo a tus documentos...'
                    }
                    value={busqueda}
                    onChange={(e) => setBusqueda(e.target.value)}
                    onKeyDown={(e) =>
                      e.key === 'Enter' && !isSearchDisabled && handleBuscar()
                    }
                    disabled={isSearchDisabled}
                    aria-disabled={isSearchDisabled}
                  />
                  <button
                    type="button"
                    className="bc-search-help-btn"
                    aria-label="Qué es la búsqueda semántica"
                    aria-describedby="bc-semantic-help-slot"
                    onMouseEnter={() => setSemanticHelpActive(true)}
                    onMouseLeave={() => setSemanticHelpActive(false)}
                    onFocus={() => setSemanticHelpActive(true)}
                    onBlur={() => setSemanticHelpActive(false)}
                    disabled={isSearchDisabled}
                  >
                    <HelpCircle size={15} strokeWidth={1.75} aria-hidden />
                  </button>
                  <button
                    type="button"
                    className="bc-search-submit-btn"
                    onClick={handleBuscar}
                    disabled={isSearchDisabled}
                  >
                    Buscar
                  </button>
                  <button
                    type="button"
                    className={`bc-filter-btn ${filtroOpen ? 'active' : ''} ${
                      hayFiltrosActivos ? 'has-filters' : ''
                    }`}
                    onClick={() => setFiltroOpen(!filtroOpen)}
                    disabled={isSearchDisabled}
                  >
                    <SlidersHorizontal size={14} />
                    <span>Criterios de Búsqueda</span>
                    {entidadesSeleccionadas.length > 0 && (
                      <span className="bc-filter-badge">
                        {entidadesSeleccionadas.length}
                      </span>
                    )}
                  </button>
                </div>

                {!isSearchDisabled && (
                  <p
                    id="bc-semantic-help-slot"
                    className={`bc-search-help-slot${semanticHelpActive ? ' is-active' : ''}`}
                    role="status"
                    aria-live="polite"
                  >
                    {semanticHelpActive
                      ? SEARCH_SEMANTIC_HELP
                      : SEARCH_SEMANTIC_HELP_HINT}
                  </p>
                )}

                {filtroOpen && (
                  <ModalFiltros
                    tiposEntidad={tiposEntidad}
                    tipoFiltroUI={tipoFiltroUI}
                    setTipoFiltroUI={setTipoFiltroUI}
                    entitySearch={entitySearch}
                    setEntitySearch={setEntitySearch}
                    entidades={entidades}
                    entidadesFiltradas={entidadesFiltradas}
                    entidadesSeleccionadas={entidadesSeleccionadas}
                    toggleEntidad={toggleEntidad}
                    logicaEntidades={logicaEntidades}
                    setLogicaEntidades={setLogicaEntidades}
                    setEntidadesSeleccionadas={setEntidadesSeleccionadas}
                  />
                )}
              </div>

              {/* ÁREA DE RESULTADOS */}

              <div className="bc-results-area">
                {loading ? (
                  <div className="bc-empty">
                    <Loader2 className="bc-spin" size={30} />
                    <p>Buscando en tus documentos...</p>
                  </div>
                ) : resultados.length > 0 ? (
                  <>
                    <div className="bc-results-meta">
                      <span className="bc-results-count">
                        {totalResults} resultado{totalResults !== 1 ? 's' : ''}{' '}
                        obtenido{totalResults !== 1 ? 's' : ''}
                        {searchTime > 0 &&
                          ` en ${searchTime.toFixed(2)} segundo${searchTime !== 1 ? 's' : ''}`}
                      </span>
                    </div>
                    <div className="bc-results-list">
                      {resultados.map((resultado) => {
                        const matchLevel = getMatchLevel(resultado.score)
                        return (
                          <article
                            key={resultado.id_chunk}
                            className="bc-result-card"
                          >
                            <div className="bc-card-header">
                              <div className="bc-header-info">
                                <div className="bc-title-row">
                                  <FileText size={14} className="bc-doc-icon" />
                                  <h3 className="bc-result-title">
                                    {resultado.titulo}
                                  </h3>
                                </div>

                                <div className="bc-score-row">
                                  <div
                                    className={`bc-score-status ${matchLevel.statusClass}`}
                                  >
                                    <CheckCircle2
                                      size={12}
                                      className="bc-status-icon"
                                    />
                                    <span className="bc-score-value">
                                      {matchLevel.label}
                                    </span>
                                  </div>
                                  <span className="bc-score-help-wrap">
                                    <button
                                      type="button"
                                      className="bc-score-help-btn"
                                      aria-label={`Qué significa ${matchLevel.label}`}
                                      aria-describedby={`bc-score-tip-${resultado.id_chunk}`}
                                    >
                                      <HelpCircle
                                        size={13}
                                        strokeWidth={1.75}
                                        aria-hidden
                                      />
                                    </button>
                                    <span
                                      id={`bc-score-tip-${resultado.id_chunk}`}
                                      className="bc-score-tooltip"
                                      role="tooltip"
                                    >
                                      {matchLevel.hint}
                                    </span>
                                  </span>
                                </div>
                              </div>

                              <button
                                onClick={() =>
                                  handleOpenDocument(resultado.storage_path)
                                }
                                className="bc-external-btn"
                              >
                                <ExternalLink size={13} />
                                <span>Ver Documento</span>
                              </button>
                            </div>

                            <div className="bc-card-body">
                              <p className="bc-result-fragment">
                                <Highlight
                                  text={resultado.fragmento}
                                  queries={[
                                    busquedaEnviada,
                                    ...entidadesSeleccionadas,
                                  ]}
                                />
                              </p>
                            </div>

                            <div className="bc-card-footer">
                              {resultado.pagina && (
                                <div className="bc-footer-tag">
                                  <span>Página {resultado.pagina}</span>
                                </div>
                              )}
                            </div>
                          </article>
                        )
                      })}
                    </div>
                    {totalPages > 1 && (
                      <div className="bc-pagination">
                        <button
                          disabled={page === 1}
                          onClick={() => setPage((p) => p - 1)}
                        >
                          Anterior
                        </button>
                        <span>
                          Página {page} de {totalPages}
                        </span>
                        <button
                          disabled={page === totalPages}
                          onClick={() => setPage((p) => p + 1)}
                        >
                          Siguiente
                        </button>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="bc-empty">
                    <div className="bc-empty-icon">
                      <Search size={30} />
                    </div>
                    <h3 className="bc-empty-title">
                      {showNuevaOnboarding
                        ? 'Empieza Subiendo Documentos'
                        : isNuevaBackgroundProcessing
                          ? 'Preparando Tu Colección'
                          : searchNotReadyMessage
                            ? 'Búsqueda No Disponible Aún'
                            : 'Sin Resultados Todavía'}
                    </h3>
                    <p className="bc-empty-sub">
                      {showNuevaOnboarding
                        ? 'Añade PDF o TXT para crear tu colección. Después podrás generar el grafo y buscar en tus documentos.'
                        : isNuevaBackgroundProcessing
                          ? 'Tus documentos se están procesando en segundo plano. Sigue el avance en la barra superior; la búsqueda estará disponible cuando termine el grafo.'
                          : (searchNotReadyMessage ??
                            (busquedaEnviada
                              ? 'No hay fragmentos que coincidan con tu búsqueda semántica.'
                              : !isGraphViewable(collectionProcessingStatus)
                                ? 'Genera el grafo de la colección para habilitar la búsqueda semántica.'
                                : 'Haz una consulta para explorar los documentos de esta colección.'))}
                    </p>
                    {showNuevaOnboarding && (
                      <button
                        type="button"
                        className="imfd-btn-primary bc-empty-cta"
                        onClick={handleOpenAddSources}
                      >
                        Añadir Fuentes
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </main>
      </div>

      {/* ──────────────────────────────────── */}
      {/* MODALES */}
      {/* ──────────────────────────────────── */}

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

      <ModalRenombrarColeccion
        isOpen={isRenombrarModalOpen}
        nombreActual={nombreColeccion}
        isSaving={guardandoNombre}
        onConfirm={confirmarRenombrar}
        onClose={() => {
          if (!guardandoNombre) setIsRenombrarModalOpen(false)
        }}
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
