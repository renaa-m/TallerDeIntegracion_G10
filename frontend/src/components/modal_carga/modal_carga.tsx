import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { useAuth0 } from '@auth0/auth0-react'
import {
  X,
  CloudUpload,
  FileText,
  Trash2,
  Loader2,
  Network,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import './modal_carga.css'
import {
  ACTIVE_COLLECTION_KEY,
  MODAL_ETAPA_KEY,
  MODAL_NUEVA_SESSION_KEY,
  clearActiveCollectionStorage,
  clearActiveCollectionStorageIfMatch,
  isPipelineInProgress,
  isPipelineRunning as isBackendPipelineRunning,
  resolveModalCollectionId,
  shouldOpenPipelineModal,
  readNuevaSessionCollectionId,
  readPipelineEntitySelection,
  persistPipelineEntitySelection,
  persistPipelineModalState,
  persistModalCargaOpen,
  getPipelineProgressDisplay,
  snapshotFromCollectionApi,
} from '../../lib/collection_processing'
import { fetchCollectionCached } from '../../lib/collection_fetch_cache'
import DEFAULT_DATA_MODEL from '../../data/defaultDataModel'

interface ModalCargaProps {
  isOpen: boolean
  onClose: () => void
  onUploadSuccess?: () => void
  /** id de la ruta (`nueva` o UUID). Evita mezclar estado entre colecciones. */
  scopeCollectionId?: string | null
  /** Usuario de la ruta (`/:id_usuario/...`) para navegar tras cancelar. */
  scopeUserId?: string | null
  onProcessingChange?: (processing: boolean) => void
  /** Abrir directamente en etapa pipeline (p. ej. barra «grafo pendiente»). */
  forcePipelineEtapa?: boolean
}

type Etapa = 'subida' | 'pipeline'
type PipelineStatus =
  | 'idle'
  | 'processing_text'
  | 'awaiting_graph_confirmation'
  | 'processing_graph'
  | 'graph_ready'
  | 'partial_error'
  | 'cancelled'
  | 'queued'
  | 'error'

type FailedProcessingDocument = {
  filename: string
  reason?: string | null
}

type StepProgress = {
  total: number
  processed: number
  failed: FailedProcessingDocument[]
}

const EMPTY_PROGRESS: StepProgress = {
  total: 0,
  processed: 0,
  failed: [],
}

const PIPELINE_LABELS: Record<PipelineStatus, string> = {
  idle: '',
  processing_text: 'Extrayendo texto de los documentos...',
  processing_graph: 'Construyendo grafo con Wukong...',
  awaiting_graph_confirmation:
    'Algunos documentos no se extrajeron. El grafo usará solo los que sí pasaron.',
  graph_ready: '¡Grafo generado correctamente!',
  partial_error: '¡Grafo generado! Revisa qué documentos quedaron fuera.',
  cancelled: 'Procesamiento cancelado.',
  queued: 'Preparando el procesamiento — comenzará automáticamente en breve...',
  error: 'Ocurrió un error durante el procesamiento.',
}

const PIPELINE_STEP_HELP: Record<
  'processing_text' | 'processing_graph' | 'graph_ready',
  string
> = {
  processing_text:
    'Lee tus documentos y extrae el texto para poder analizarlo después.',
  processing_graph:
    'Detecta entidades y relaciones en el texto y construye el grafo de conocimiento.',
  graph_ready:
    'Proceso completado. Ya puedes buscar en la colección y explorar el grafo.',
}

type PipelineStepKey = keyof typeof PIPELINE_STEP_HELP

const LANGUAGE_OPTIONS = [
  { value: 'es', label: 'Español' },
  { value: 'en', label: 'English' },
] as const

/** El backend usa ``cancelled``; en la UI equivalen a “listo para generar de nuevo”. */
function pipelineStatusFromApi(raw: string | undefined): PipelineStatus {
  if (raw === 'cancelled') return 'idle'
  if (raw === 'queued') return 'queued'
  if (
    raw === 'idle' ||
    raw === 'processing_text' ||
    raw === 'processing_graph' ||
    raw === 'awaiting_graph_confirmation' ||
    raw === 'graph_ready' ||
    raw === 'partial_error' ||
    raw === 'error'
  ) {
    return raw
  }
  return 'idle'
}

/** Evita que un GET en vuelo (anterior al POST) pise queued/processing con idle. */
function shouldApplyApiPipelineStatus(
  localStatus: PipelineStatus,
  apiRawStatus: string | undefined,
): boolean {
  const apiRaw = apiRawStatus ?? 'idle'
  if (pipelineStatusFromApi(apiRaw) === localStatus) return true

  const localActive =
    isPipelineInProgress(localStatus) || localStatus === 'queued'
  const apiActive = isPipelineInProgress(apiRaw) || apiRaw === 'queued'

  return !(localActive && !apiActive && apiRaw === 'idle')
}

function resolveEffectiveProcessingStatus(
  localStatus: PipelineStatus,
  apiRawStatus: string | undefined,
): string {
  if (shouldApplyApiPipelineStatus(localStatus, apiRawStatus)) {
    return apiRawStatus ?? 'idle'
  }
  if (localStatus === 'queued') return 'queued'
  if (isPipelineInProgress(localStatus)) return localStatus
  return apiRawStatus ?? 'idle'
}

function getPipelineStatusLabel(
  status: PipelineStatus,
  textProgress: StepProgress,
): string {
  if (status === 'awaiting_graph_confirmation') {
    if (textProgress.failed.length > 0) {
      return `${textProgress.failed.length} documento(s) sin extraer · ${textProgress.processed} listo(s) para el grafo`
    }
    return PIPELINE_LABELS.awaiting_graph_confirmation
  }
  if (
    status === 'error' &&
    textProgress.processed === 0 &&
    textProgress.total > 0
  ) {
    return 'Ningún documento se pudo procesar'
  }
  return PIPELINE_LABELS[status] ?? status
}

type PipelineNoticeKind = 'none' | 'info' | 'warn' | 'success' | 'error'

function getPipelineNoticeKind(
  status: PipelineStatus,
  graphProgress: StepProgress,
): PipelineNoticeKind {
  if (status === 'error') return 'error'
  if (status === 'graph_ready') return 'success'
  if (status === 'partial_error') {
    return graphProgress.processed > 0 ? 'success' : 'warn'
  }
  if (status === 'awaiting_graph_confirmation') return 'warn'
  return 'none'
}

function getCancellingMessage(
  etapa: Etapa,
  pipelineStatus: PipelineStatus,
): string {
  if (etapa === 'subida') {
    return 'Eliminando colección y volviendo al inicio…'
  }
  if (pipelineStatus === 'processing_text') {
    return 'Deteniendo la extracción y eliminando la colección. Puede tardar un momento mientras terminan las tareas en curso.'
  }
  if (pipelineStatus === 'processing_graph') {
    return 'Deteniendo la construcción del grafo y eliminando la colección. Puede tardar un momento mientras terminan las tareas en curso.'
  }
  return 'Eliminando colección y volviendo al inicio…'
}

const API_BASE = import.meta.env.VITE_API_URL?.replace(/\/$/, '') || ''

const ENTITY_OPTIONS = ['Persona', 'Organizacion', 'Lugar', 'Evento'] as const

const ModalCarga = ({
  isOpen,
  onClose,
  onUploadSuccess,
  scopeCollectionId = null,
  scopeUserId = null,
  onProcessingChange,
  forcePipelineEtapa = false,
}: ModalCargaProps) => {
  const { getAccessTokenSilently, user } = useAuth0()
  const navigate = useNavigate()
  const authUserId = user?.sub?.split('|')[1] || user?.nickname
  const landingUserId = scopeUserId ?? authUserId

  // --- Estados ---
  const [files, setFiles] = useState<File[]>([])
  const [isDragging, setIsDragging] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [uploadedCount, setUploadedCount] = useState(0)
  const [uploadTotal, setUploadTotal] = useState(0)
  const [nombreColeccion, setNombreColeccion] = useState('')
  /* Idioma español por defecto, pero se puede extender para soportar otros idiomas en el futuro. */
  const [idioma, setIdioma] = useState<string>('es')
  const [selectedEntities, setSelectedEntities] = useState<string[]>([])
  const [error, setError] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)
  /** ID de colección en creación/subida (sincrónico; el state puede ir retrasado). */
  const uploadCollectionIdRef = useRef<string | null>(null)
  const uploadInFlightRef = useRef(false)

  const [etapa, setEtapa] = useState<Etapa>('subida')
  const [pipelineStatus, setPipelineStatus] = useState<PipelineStatus>('idle')
  const [pipelineError, setPipelineError] = useState('')
  const [activeCollectionId, setActiveCollectionId] = useState<string | null>(
    null,
  )
  const [textProgress, setTextProgress] = useState<StepProgress>(EMPTY_PROGRESS)
  const [graphProgress, setGraphProgress] =
    useState<StepProgress>(EMPTY_PROGRESS)
  const [isCancelling, setIsCancelling] = useState(false)
  const [stepHelpTip, setStepHelpTip] = useState<PipelineStepKey | null>(null)
  const [isSubmittingPipeline, setIsSubmittingPipeline] = useState(false)

  const pipelineStatusRef = useRef<PipelineStatus>('idle')
  const isSubmittingPipelineRef = useRef(false)

  useEffect(() => {
    pipelineStatusRef.current = pipelineStatus
  }, [pipelineStatus])

  useEffect(() => {
    isSubmittingPipelineRef.current = isSubmittingPipeline
  }, [isSubmittingPipeline])

  const isUploadingLocked = isUploading || isCancelling
  const resolvedCollectionId = useMemo(
    () => resolveModalCollectionId(scopeCollectionId, activeCollectionId),
    [scopeCollectionId, activeCollectionId],
  )
  const nuevaSessionCollectionId =
    scopeCollectionId === 'nueva' ? activeCollectionId : null
  const resolvedEtapa: Etapa = useMemo(() => {
    if (
      forcePipelineEtapa &&
      scopeCollectionId &&
      scopeCollectionId !== 'nueva'
    ) {
      return 'pipeline'
    }

    const trackedId =
      resolveModalCollectionId(scopeCollectionId, activeCollectionId) ??
      (scopeCollectionId === 'nueva' ? readNuevaSessionCollectionId() : null)
    if (
      trackedId &&
      localStorage.getItem(ACTIVE_COLLECTION_KEY) === trackedId &&
      localStorage.getItem(MODAL_ETAPA_KEY) === 'pipeline'
    ) {
      return 'pipeline'
    }

    if (
      forcePipelineEtapa &&
      scopeCollectionId === 'nueva' &&
      readNuevaSessionCollectionId() &&
      localStorage.getItem(MODAL_ETAPA_KEY) === 'pipeline'
    ) {
      return 'pipeline'
    }

    return etapa
  }, [forcePipelineEtapa, scopeCollectionId, activeCollectionId, etapa])
  const isPipelineRunning =
    pipelineStatus === 'processing_text' ||
    pipelineStatus === 'processing_graph'

  const abortControllersRef = useRef<AbortController[]>([])
  const isOpenRef = useRef(isOpen)

  useEffect(() => {
    isOpenRef.current = isOpen
  }, [isOpen])

  const persistBackgroundProcessing = useCallback(
    (collectionId: string, options?: { nuevaSession?: boolean }) => {
      persistPipelineModalState(collectionId, options)
    },
    [],
  )

  const updateSelectedEntities = useCallback(
    (updater: (prev: string[]) => string[]) => {
      setSelectedEntities((prev) => {
        const next = updater(prev)
        if (resolvedCollectionId) {
          persistPipelineEntitySelection(resolvedCollectionId, next)
        }
        return next
      })
    },
    [resolvedCollectionId],
  )

  useEffect(() => {
    if (!isOpen || !resolvedCollectionId || resolvedEtapa !== 'pipeline') return
    if (pipelineStatus !== 'idle') return

    const saved = readPipelineEntitySelection(resolvedCollectionId)
    queueMicrotask(() => {
      setSelectedEntities(saved)
    })
  }, [isOpen, resolvedCollectionId, resolvedEtapa, pipelineStatus])

  const resetUploadForm = useCallback(() => {
    setFiles([])
    setNombreColeccion('')
    setSelectedEntities([])
    setError('')
    setEtapa('subida')
    setPipelineStatus('idle')
    setPipelineError('')
    setActiveCollectionId(null)
    setIsUploading(false)
    setUploadedCount(0)
    setUploadTotal(0)
    setTextProgress(EMPTY_PROGRESS)
    setGraphProgress(EMPTY_PROGRESS)
    uploadCollectionIdRef.current = null
    setIsCancelling(false)
  }, [])

  const deleteActiveCollection = useCallback(
    async (collectionId: string): Promise<boolean> => {
      try {
        const token = await getAccessTokenSilently()
        const res = await fetch(`${API_BASE}/api/collections/${collectionId}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        })
        return res.status === 404 || res.ok
      } catch (err) {
        console.error('Error eliminando colección:', err)
        return false
      }
    },
    [getAccessTokenSilently],
  )

  // --- 1. Sincronización: colección de la ruta o sesión en /nueva ---
  useEffect(() => {
    const syncStatus = async () => {
      if (!isOpen || isCancelling || isSubmittingPipelineRef.current) return

      const collectionId =
        scopeCollectionId && scopeCollectionId !== 'nueva'
          ? scopeCollectionId
          : (nuevaSessionCollectionId ??
            readNuevaSessionCollectionId() ??
            (localStorage.getItem(MODAL_NUEVA_SESSION_KEY) === '1'
              ? localStorage.getItem(ACTIVE_COLLECTION_KEY)
              : null))

      if (!collectionId) return

      if (scopeCollectionId && scopeCollectionId !== 'nueva') {
        setActiveCollectionId(scopeCollectionId)
      } else if (scopeCollectionId === 'nueva' && collectionId) {
        setActiveCollectionId(collectionId)
      }

      try {
        const token = await getAccessTokenSilently()
        const res = await fetchCollectionCached(
          `${API_BASE}/api/collections/${collectionId}`,
          { Authorization: `Bearer ${token}` },
        )
        if (!isOpenRef.current || isCancelling) return
        if (res.status === 404) {
          if (localStorage.getItem(ACTIVE_COLLECTION_KEY) === collectionId) {
            clearActiveCollectionStorage()
          }
          resetUploadForm()
          onProcessingChange?.(false)
          return
        }
        if (res.ok) {
          const data = await res.json()
          setTextProgress({
            total: data.text_progress_total ?? 0,
            processed: data.text_progress_processed ?? 0,
            failed: data.text_failed_documents ?? [],
          })
          setGraphProgress({
            total: data.graph_progress_total ?? 0,
            processed: data.graph_progress_processed ?? 0,
            failed: data.graph_failed_documents ?? [],
          })
          const status = pipelineStatusFromApi(data.processing_status)
          const effectiveStatus = resolveEffectiveProcessingStatus(
            pipelineStatusRef.current,
            data.processing_status,
          )
          if (
            shouldApplyApiPipelineStatus(
              pipelineStatusRef.current,
              data.processing_status,
            )
          ) {
            setPipelineStatus(status)
            onProcessingChange?.(isPipelineInProgress(data.processing_status))
          }

          if (isPipelineInProgress(effectiveStatus)) {
            localStorage.setItem(ACTIVE_COLLECTION_KEY, collectionId)
            localStorage.setItem(MODAL_ETAPA_KEY, 'pipeline')
          }

          if (
            effectiveStatus === 'partial_error' ||
            effectiveStatus === 'error' ||
            effectiveStatus === 'awaiting_graph_confirmation'
          ) {
            setPipelineError(data.processing_error_message ?? '')
          } else if (effectiveStatus === 'graph_ready') {
            setPipelineError('')
          } else if (status !== 'error' && status !== 'partial_error') {
            setPipelineError('')
          }

          const savedId = localStorage.getItem(ACTIVE_COLLECTION_KEY)
          const savedEtapa = localStorage.getItem(MODAL_ETAPA_KEY) as Etapa
          if (
            !isPipelineInProgress(effectiveStatus) &&
            savedId === collectionId
          ) {
            const esperandoGrafo =
              effectiveStatus === 'idle' && savedEtapa === 'pipeline'
            const uploadEnCurso = savedEtapa === 'subida'
            if (!esperandoGrafo && !uploadEnCurso) {
              clearActiveCollectionStorage()
              onProcessingChange?.(false)
            }
          }

          let documentCount = 0
          if (effectiveStatus === 'idle') {
            try {
              const docsRes = await fetch(
                `${API_BASE}/api/documentos?coleccion_id=${collectionId}`,
                { headers: { Authorization: `Bearer ${token}` } },
              )
              if (docsRes.ok) {
                const docs = await docsRes.json()
                documentCount = Array.isArray(docs) ? docs.length : 0
              }
            } catch {
              documentCount = 0
            }
          }

          if (!isOpenRef.current || isCancelling) return

          if (
            savedEtapa === 'subida' &&
            !isPipelineInProgress(data.processing_status)
          ) {
            if (uploadInFlightRef.current) {
              return
            }

            await deleteActiveCollection(collectionId)
            clearActiveCollectionStorage()
            resetUploadForm()
            onProcessingChange?.(false)
            return
          }

          const openPipeline =
            forcePipelineEtapa ||
            shouldOpenPipelineModal(effectiveStatus, {
              documentCount,
              savedModalEtapa: savedEtapa,
            })

          if (openPipeline) {
            setEtapa('pipeline')
            localStorage.setItem(ACTIVE_COLLECTION_KEY, collectionId)
            localStorage.setItem(MODAL_ETAPA_KEY, 'pipeline')
          } else {
            setEtapa('subida')
          }
        }
      } catch (e) {
        console.error('Error al recuperar estado tras recarga:', e)
      }
    }
    syncStatus()
  }, [
    isOpen,
    isCancelling,
    scopeCollectionId,
    nuevaSessionCollectionId,
    forcePipelineEtapa,
    getAccessTokenSilently,
    onProcessingChange,
    resetUploadForm,
    deleteActiveCollection,
  ])

  /** Cancelar: elimina la colección y redirige al landing. */
  const handleCancel = useCallback(async () => {
    if (isCancelling) return
    setIsCancelling(true)
    abortControllersRef.current.forEach((controller) => controller.abort())
    abortControllersRef.current = []
    setError('')

    const collectionId = uploadCollectionIdRef.current ?? resolvedCollectionId

    if (collectionId) {
      clearActiveCollectionStorageIfMatch(collectionId)
    } else {
      clearActiveCollectionStorage()
    }

    let deleteSucceeded = !collectionId
    try {
      if (collectionId) {
        if (
          isBackendPipelineRunning(pipelineStatus) ||
          pipelineStatus === 'queued'
        ) {
          try {
            const token = await getAccessTokenSilently()
            await fetch(
              `${API_BASE}/api/collections/${collectionId}/process/cancel`,
              {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}` },
              },
            )
          } catch (err) {
            console.error('Error solicitando detención del procesamiento:', err)
          }
        }
        deleteSucceeded = await deleteActiveCollection(collectionId)
        if (!deleteSucceeded) {
          setError('No se pudo eliminar la colección. Intenta de nuevo.')
          setIsCancelling(false)
          return
        }
      }
    } finally {
      if (landingUserId && deleteSucceeded) {
        navigate(`/landing-page/${landingUserId}`, { replace: true })
      }
      if (deleteSucceeded) {
        resetUploadForm()
        onProcessingChange?.(false)
        onClose()
      }
    }
  }, [
    isCancelling,
    resolvedCollectionId,
    pipelineStatus,
    landingUserId,
    deleteActiveCollection,
    getAccessTokenSilently,
    navigate,
    onClose,
    onProcessingChange,
    resetUploadForm,
  ])

  /** X u overlay: cerrar sin borrar (pipeline activo o en espera → segundo plano). */
  const handleDismiss = useCallback(() => {
    if (isCancelling) return

    const collectionId = uploadCollectionIdRef.current ?? resolvedCollectionId
    const subidaEnCurso =
      isUploading ||
      uploadInFlightRef.current ||
      localStorage.getItem(MODAL_ETAPA_KEY) === 'subida'

    // Nueva colección en subida: cancelar interrumpe y borra en cascada → landing.
    if (scopeCollectionId === 'nueva' && resolvedEtapa === 'subida') {
      if (subidaEnCurso || collectionId) {
        void handleCancel()
        return
      }
      clearActiveCollectionStorage()
      resetUploadForm()
      onProcessingChange?.(false)
      onClose()
      if (landingUserId) {
        navigate(`/landing-page/${landingUserId}`, { replace: true })
      }
      return
    }

    if (isUploading) return

    // Cerrar en etapa de subida para colección existente: solo cerrar modal.
    if (resolvedEtapa === 'subida') {
      onClose()
      return
    }

    if (
      resolvedEtapa === 'pipeline' &&
      isPipelineInProgress(pipelineStatus) &&
      resolvedCollectionId
    ) {
      persistBackgroundProcessing(resolvedCollectionId, {
        nuevaSession: scopeCollectionId === 'nueva',
      })
      persistModalCargaOpen(false)
      onProcessingChange?.(true)
      onClose()
      if (scopeCollectionId === 'nueva' && landingUserId) {
        navigate(
          `/${landingUserId}/colecciones/${resolvedCollectionId}/buscador`,
        )
      }
      return
    }

    // Docs listos, grafo pendiente: cerrar modal pero mantener colección y ruta.
    if (
      resolvedEtapa === 'pipeline' &&
      pipelineStatus === 'idle' &&
      resolvedCollectionId
    ) {
      if (scopeCollectionId && scopeCollectionId !== 'nueva') {
        localStorage.setItem(ACTIVE_COLLECTION_KEY, resolvedCollectionId)
        localStorage.setItem(MODAL_ETAPA_KEY, 'pipeline')
      }
      persistModalCargaOpen(false)
      onClose()
      if (scopeCollectionId === 'nueva' && landingUserId) {
        navigate(
          `/${landingUserId}/colecciones/${resolvedCollectionId}/buscador`,
        )
      }
      return
    }

    onClose()
  }, [
    resolvedCollectionId,
    landingUserId,
    resolvedEtapa,
    isUploading,
    isCancelling,
    navigate,
    onClose,
    onProcessingChange,
    handleCancel,
    persistBackgroundProcessing,
    pipelineStatus,
    scopeCollectionId,
    resetUploadForm,
  ])

  // Si el modal se cierra mientras sube en /nueva, borrar en cascada (p. ej. navegación).
  useEffect(() => {
    if (isOpen || scopeCollectionId !== 'nueva' || isCancelling) return
    if (!isUploading && !uploadInFlightRef.current) return
    if (localStorage.getItem(MODAL_ETAPA_KEY) !== 'subida') return

    queueMicrotask(() => {
      void handleCancel()
    })
  }, [isOpen, scopeCollectionId, isUploading, isCancelling, handleCancel])

  // Al salir de /nueva con subida pendiente (p. ej. navbar), borrar colección huérfana.
  useEffect(() => {
    return () => {
      if (scopeCollectionId !== 'nueva') return
      if (localStorage.getItem(MODAL_ETAPA_KEY) !== 'subida') return
      const collectionId =
        uploadCollectionIdRef.current ??
        localStorage.getItem(ACTIVE_COLLECTION_KEY)
      if (!collectionId) return
      abortControllersRef.current.forEach((controller) => controller.abort())
      clearActiveCollectionStorage()
      void getAccessTokenSilently()
        .then((token) =>
          fetch(`${API_BASE}/api/collections/${collectionId}`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${token}` },
          }),
        )
        .catch(() => {})
    }
  }, [scopeCollectionId, getAccessTokenSilently])

  // --- 3. Polling de Pipeline (solo con modal abierto y colección de la ruta) ---
  const isCancellingRef = useRef(isCancelling)
  useEffect(() => {
    isCancellingRef.current = isCancelling
  }, [isCancelling])

  const onProcessingChangeRef = useRef(onProcessingChange)
  useEffect(() => {
    onProcessingChangeRef.current = onProcessingChange
  }, [onProcessingChange])

  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  const resetUploadFormRef = useRef(resetUploadForm)
  useEffect(() => {
    resetUploadFormRef.current = resetUploadForm
  }, [resetUploadForm])

  useEffect(() => {
    if (
      !isOpen ||
      isCancelling ||
      resolvedEtapa !== 'pipeline' ||
      !resolvedCollectionId ||
      (scopeCollectionId &&
        scopeCollectionId !== 'nueva' &&
        resolvedCollectionId !== scopeCollectionId)
    )
      return

    const terminalStatuses = ['graph_ready', 'partial_error', 'error', 'idle']
    if (terminalStatuses.includes(pipelineStatusRef.current)) return

    const collectionId = resolvedCollectionId
    const interval = window.setInterval(async () => {
      try {
        if (!isOpenRef.current || isCancellingRef.current) {
          clearInterval(interval)
          return
        }
        const token = await getAccessTokenSilently()
        const res = await fetchCollectionCached(
          `${API_BASE}/api/collections/${collectionId}`,
          { Authorization: `Bearer ${token}` },
        )
        if (!isOpenRef.current || isCancellingRef.current) {
          clearInterval(interval)
          return
        }
        if (res.status === 404) {
          clearActiveCollectionStorageIfMatch(collectionId)
          clearInterval(interval)
          resetUploadFormRef.current()
          onProcessingChangeRef.current?.(false)
          onCloseRef.current()
          return
        }
        if (!res.ok) return
        const data = await res.json()
        setTextProgress({
          total: data.text_progress_total ?? 0,
          processed: data.text_progress_processed ?? 0,
          failed: data.text_failed_documents ?? [],
        })

        setGraphProgress({
          total: data.graph_progress_total ?? 0,
          processed: data.graph_progress_processed ?? 0,
          failed: data.graph_failed_documents ?? [],
        })
        const status = pipelineStatusFromApi(data.processing_status)
        if (
          shouldApplyApiPipelineStatus(
            pipelineStatusRef.current,
            data.processing_status,
          )
        ) {
          setPipelineStatus(status)
          onProcessingChangeRef.current?.(isPipelineInProgress(data.processing_status))
        }
        if (
          status === 'graph_ready' ||
          status === 'partial_error' ||
          status === 'error' ||
          data.processing_status === 'cancelled'
        ) {
          if (status === 'graph_ready') {
            setPipelineError('')
          } else if (status === 'error' || status === 'partial_error') {
            setPipelineError(data.processing_error_message ?? '')
          }
          if (data.processing_status === 'cancelled') {
            setPipelineError('')
          }
          onProcessingChangeRef.current?.(false)
          clearInterval(interval)
        } else if (status === 'awaiting_graph_confirmation') {
          setPipelineError(data.processing_error_message ?? '')
        }
      } catch (e) {
        console.error('Error en polling:', e)
      }
    }, 3000)
    return () => clearInterval(interval)
  }, [
    isOpen,
    isCancelling,
    resolvedEtapa,
    resolvedCollectionId,
    scopeCollectionId,
    getAccessTokenSilently,
  ])
  const isAllowedFile = (file: File) => {
    const fileName = file.name.toLowerCase()
    return fileName.endsWith('.pdf') || fileName.endsWith('.txt')
  }

  const filterAllowedFiles = (incomingFiles: File[]) => {
    const validFiles = incomingFiles.filter(isAllowedFile)
    const invalidFiles = incomingFiles.filter((file) => !isAllowedFile(file))

    if (invalidFiles.length > 0) {
      setError('Solo se permiten archivos PDF o TXT.')
    } else {
      setError('')
    }

    return validFiles
  }
  const handleUpload = async () => {
    if (files.length === 0) return
    uploadInFlightRef.current = true
    setIsUploading(true)
    setError('')
    setUploadTotal(files.length)
    setUploadedCount(0)

    try {
      const token = await getAccessTokenSilently()
      const existingCollectionId =
        uploadCollectionIdRef.current ??
        activeCollectionId ??
        (scopeCollectionId === 'nueva' ? readNuevaSessionCollectionId() : null)

      let collection: { id: string; name?: string }
      if (existingCollectionId) {
        collection = { id: existingCollectionId }
      } else {
        const res = await fetch(`${API_BASE}/api/collections`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            name: nombreColeccion || 'Nueva Colección',
            description: '',
            language: idioma,
          }),
        })
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error(body?.detail ?? 'Error al crear colección')
        }
        collection = await res.json()
      }

      uploadCollectionIdRef.current = collection.id
      setActiveCollectionId(collection.id)
      localStorage.setItem(ACTIVE_COLLECTION_KEY, collection.id)
      localStorage.setItem(MODAL_ETAPA_KEY, 'subida')
      if (scopeCollectionId === 'nueva') {
        localStorage.setItem(MODAL_NUEVA_SESSION_KEY, '1')
      }

      let uploaded = 0
      const uploadErrors: string[] = []
      for (const file of files) {
        const controller = new AbortController()
        abortControllersRef.current.push(controller)

        const formData = new FormData()
        formData.append('file', file)
        const upRes = await fetch(
          `${API_BASE}/api/documentos/upload?coleccion_id=${collection.id}`,
          {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` },
            body: formData,
            signal: controller.signal,
          },
        )
        if (upRes.ok || upRes.status === 409) {
          uploaded++
          setUploadedCount(uploaded)
        } else {
          try {
            const body = await upRes.json()
            const msg = body?.detail ?? `Error al subir "${file.name}"`
            uploadErrors.push(msg)
          } catch {
            uploadErrors.push(`Error al subir "${file.name}"`)
          }
        }
      }

      if (uploaded === 0) {
        const reason =
          uploadErrors.length > 0 ? uploadErrors[0] : 'No se subieron archivos.'
        throw new Error(reason)
      }

      setEtapa('pipeline')
      persistBackgroundProcessing(collection.id, {
        nuevaSession: scopeCollectionId === 'nueva',
      })
      if (onUploadSuccess) onUploadSuccess()
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return
      }

      if (
        err instanceof Error &&
        err.message.toLowerCase().includes('aborted')
      ) {
        return
      }

      setError(err instanceof Error ? err.message : 'Error en la carga')
    } finally {
      uploadInFlightRef.current = false
      setIsUploading(false)
    }
  }

  const relationUsesOnlySelectedEntities = (
    relation: (typeof DEFAULT_DATA_MODEL.relations)[keyof typeof DEFAULT_DATA_MODEL.relations],
    entitiesToUse: string[],
  ) => {
    if ('origin_target' in relation && relation.origin_target) {
      return Object.entries(relation.origin_target).every(
        ([origin, targets]) =>
          entitiesToUse.includes(origin) &&
          targets.every((target: string) => entitiesToUse.includes(target)),
      )
    }

    if (
      'origin' in relation &&
      'target' in relation &&
      relation.origin &&
      relation.target
    ) {
      return (
        relation.origin.every((origin) => entitiesToUse.includes(origin)) &&
        relation.target.every((target) => entitiesToUse.includes(target))
      )
    }

    return false
  }

  const buildCustomDataModel = () => {
    const entitiesToUse: string[] =
      selectedEntities.length > 0
        ? selectedEntities
        : [...DEFAULT_DATA_MODEL.parameters.included_entities]

    const relations = Object.fromEntries(
      Object.entries(DEFAULT_DATA_MODEL.relations).filter(([, relation]) =>
        relationUsesOnlySelectedEntities(relation, entitiesToUse),
      ),
    )

    return {
      ...DEFAULT_DATA_MODEL,
      parameters: {
        ...DEFAULT_DATA_MODEL.parameters,
        included_entities: entitiesToUse,
        included_relations: Object.keys(relations),
      },
      entities: Object.fromEntries(
        Object.entries(DEFAULT_DATA_MODEL.entities).filter(([entityName]) =>
          entitiesToUse.includes(entityName),
        ),
      ),
      relations,
    }
  }

  const applyPipelineStatusFromApi = useCallback(
    (rawStatus: string | undefined, collectionId: string) => {
      const nextStatus = pipelineStatusFromApi(rawStatus)
      pipelineStatusRef.current = nextStatus
      setPipelineStatus(nextStatus)
      if (isPipelineInProgress(rawStatus)) {
        persistBackgroundProcessing(collectionId, {
          nuevaSession: scopeCollectionId === 'nueva',
        })
      }
      onProcessingChange?.(isPipelineInProgress(rawStatus))
    },
    [onProcessingChange, persistBackgroundProcessing, scopeCollectionId],
  )

  const handleIniciarPipeline = async () => {
    if (!resolvedCollectionId || isSubmittingPipeline) return
    setIsSubmittingPipeline(true)
    setPipelineError('')
    setEtapa('pipeline')
    try {
      const token = await getAccessTokenSilently()
      const customDataModel = buildCustomDataModel()
      const res = await fetch(
        `${API_BASE}/api/collections/${resolvedCollectionId}/generate-graph`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(customDataModel),
        },
      )
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(
          typeof data.detail === 'string'
            ? data.detail
            : 'Error al iniciar Wukong',
        )
      }
      applyPipelineStatusFromApi(data.processing_status, resolvedCollectionId)
    } catch (e: unknown) {
      setPipelineError(
        e instanceof Error ? e.message : 'Error al iniciar el procesamiento',
      )
    } finally {
      setIsSubmittingPipeline(false)
    }
  }

  // Finalización exitosa o con advertencias: no borra la colección en servidor.
  const handleFinalizarExito = () => {
    clearActiveCollectionStorage()
    onProcessingChange?.(false)
    onClose()
    if (resolvedCollectionId && landingUserId) {
      navigate(`/${landingUserId}/colecciones/${resolvedCollectionId}/buscador`)
    }
  }

  const pipelineProgressDisplay = useMemo(() => {
    return getPipelineProgressDisplay(
      snapshotFromCollectionApi(
        {
          processing_status: pipelineStatus,
          text_progress_total: textProgress.total,
          text_progress_processed: textProgress.processed,
          graph_progress_total: graphProgress.total,
          graph_progress_processed: graphProgress.processed,
        },
        resolvedCollectionId ?? '',
      ),
    )
  }, [pipelineStatus, textProgress, graphProgress, resolvedCollectionId])

  const pipelineStatusLabel = useMemo(() => {
    if (isCancelling) {
      return getCancellingMessage(resolvedEtapa, pipelineStatus)
    }
    return getPipelineStatusLabel(pipelineStatus, textProgress)
  }, [isCancelling, resolvedEtapa, pipelineStatus, textProgress])

  const cancellingMessage = useMemo(
    () => getCancellingMessage(resolvedEtapa, pipelineStatus),
    [resolvedEtapa, pipelineStatus],
  )

  const pipelineNoticeKind = useMemo(
    () => getPipelineNoticeKind(pipelineStatus, graphProgress),
    [pipelineStatus, graphProgress],
  )

  const textSuccessCount = textProgress.processed

  const graphSuccessCount = graphProgress.processed

  const handleContinuarConGrafo = async () => {
    if (!resolvedCollectionId) return

    try {
      setPipelineError('')
      const token = await getAccessTokenSilently()
      const customDataModel = buildCustomDataModel()
      const res = await fetch(
        `${API_BASE}/api/collections/${resolvedCollectionId}/generate-graph/continue-graph`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(customDataModel),
        },
      )

      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(
          typeof data.detail === 'string'
            ? data.detail
            : 'Error al continuar con el grafo',
        )
      }

      setEtapa('pipeline')
      applyPipelineStatusFromApi(data.processing_status, resolvedCollectionId)
    } catch (e: unknown) {
      setPipelineError(
        e instanceof Error ? e.message : 'Error al continuar con el grafo',
      )
    }
  }

  if (!isOpen) return null

  const cancelButtonLabel = isCancelling ? (
    <>
      <Loader2 size={14} className="mc-spin" aria-hidden />
      Cancelando…
    </>
  ) : (
    'Cancelar'
  )

  return (
    <div
      className="mc-overlay"
      onClick={isCancelling ? undefined : handleDismiss}
    >
      <div
        className={`mc-panel${isCancelling ? ' is-cancelling' : ''}`}
        onClick={(e) => e.stopPropagation()}
      >
        {isCancelling && (
          <div
            className="mc-cancelling-banner"
            role="status"
            aria-live="polite"
          >
            <Loader2 size={18} className="mc-spin" aria-hidden />
            <span>{cancellingMessage}</span>
          </div>
        )}
        <div className="mc-header">
          <div className="mc-header-main">
            <h2 className="mc-title">
              {resolvedEtapa === 'subida' ? 'Añadir fuentes' : 'Procesar grafo'}
            </h2>
            <p className="mc-subtitle">
              {resolvedEtapa === 'subida'
                ? 'Sube documentos para indexar'
                : isCancelling
                  ? cancellingMessage
                  : 'Construye el grafo de conocimiento'}
            </p>
          </div>
          <button
            className="mc-close"
            onClick={handleDismiss}
            disabled={isCancelling}
            aria-label="Cerrar"
            title={
              isCancelling
                ? cancellingMessage
                : scopeCollectionId === 'nueva' && resolvedEtapa === 'subida'
                  ? 'Cancelar subida y volver al inicio'
                  : 'Cerrar'
            }
          >
            <X size={18} />
          </button>
        </div>

        {resolvedEtapa === 'subida' ? (
          <>
            <div
              className={`mc-dropzone ${isDragging ? 'dragging' : ''} ${isUploadingLocked ? 'disabled' : ''}`}
              onDragOver={(e) => {
                e.preventDefault()
                if (!isUploadingLocked) setIsDragging(true)
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={(e) => {
                e.preventDefault()
                setIsDragging(false)
                if (isUploadingLocked) return
                const droppedFiles = Array.from(e.dataTransfer.files)
                const validFiles = filterAllowedFiles(droppedFiles)
                if (validFiles.length === 0) return
                setFiles((prev) => [...prev, ...validFiles])
              }}
              onClick={() => {
                if (!isUploadingLocked) fileInputRef.current?.click()
              }}
            >
              <input
                type="file"
                multiple
                hidden
                ref={fileInputRef}
                accept=".pdf,.txt"
                onChange={(e) => {
                  const selectedFiles = Array.from(e.target.files || [])
                  const validFiles = filterAllowedFiles(selectedFiles)
                  if (validFiles.length === 0) return
                  setFiles((prev) => [...prev, ...validFiles])
                  e.target.value = ''
                }}
                disabled={isUploadingLocked}
              />
              <div className="mc-drop-icon">
                <CloudUpload size={26} />
              </div>
              <p className="mc-drop-title">
                {isDragging
                  ? 'Suelta los archivos'
                  : 'Arrastra tus archivos aquí'}
              </p>
              <p className="mc-drop-sub">PDF o TXT · Máx. 30 MB</p>
            </div>

            {files.length > 0 && (
              <div className="mc-file-list">
                {files.map((f, i) => (
                  <div key={`${f.name}-${i}`} className="mc-file-item">
                    <FileText size={14} className="mc-file-icon" />
                    <span className="mc-file-name">{f.name}</span>
                    <button
                      className="mc-file-remove"
                      disabled={isUploadingLocked}
                      onClick={() =>
                        setFiles((prev) => prev.filter((_, idx) => idx !== i))
                      }
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {error && (
              <p className="mc-error-message">
                <AlertCircle size={14} /> {error}
              </p>
            )}
            {isUploading && (
              <p className="mc-success-message">
                Subiendo {uploadedCount} de {uploadTotal || files.length}...
              </p>
            )}

            <div className="mc-collection-name">
              <input
                type="text"
                className="mc-input"
                placeholder="Nombre de colección"
                value={nombreColeccion}
                onChange={(e) => setNombreColeccion(e.target.value)}
                disabled={isUploadingLocked}
              />
            </div>

            {/* 4. Selector de Idioma integrado */}
            <div className="mc-language-selector">
              <label className="mc-label-custom">
                Idioma de los documentos
              </label>
              <select
                className="mc-input"
                value={idioma}
                onChange={(e) => setIdioma(e.target.value)}
                disabled={isUploadingLocked}
              >
                {LANGUAGE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="mc-footer">
              <button
                className="mc-btn-cancel"
                type="button"
                onClick={handleCancel}
                disabled={isCancelling}
              >
                {cancelButtonLabel}
              </button>
              <button
                className="mc-btn-upload"
                onClick={handleUpload}
                disabled={
                  files.length === 0 ||
                  isUploadingLocked ||
                  !nombreColeccion.trim()
                }
              >
                {isUploading ? 'Subiendo...' : 'Añadir archivos'}
              </button>
            </div>
          </>
        ) : (
          <div className="mc-pipeline">
            <div className="mc-steps" onMouseLeave={() => setStepHelpTip(null)}>
              {['processing_text', 'processing_graph', 'graph_ready'].map(
                (s, idx) => {
                  const stepLabel = ['Extracción', 'Construcción', 'Listo'][idx]
                  const isDone =
                    (s === 'processing_text' &&
                      (pipelineStatus === 'processing_graph' ||
                        pipelineStatus === 'graph_ready' ||
                        pipelineStatus === 'partial_error')) ||
                    (s === 'processing_graph' &&
                      (pipelineStatus === 'graph_ready' ||
                        pipelineStatus === 'partial_error')) ||
                    (s === 'graph_ready' &&
                      (pipelineStatus === 'graph_ready' ||
                        pipelineStatus === 'partial_error')) ||
                    s === pipelineStatus
                  const isActive =
                    !isCancelling &&
                    s === pipelineStatus &&
                    pipelineStatus !== 'graph_ready'
                  const isPending = !isActive && !isDone
                  return (
                    <div
                      key={s}
                      className={`mc-step${isActive ? ' active' : ''}${isDone ? ' done' : ''}${isPending ? ' pending' : ''}`}
                    >
                      <div className="mc-step-icon">
                        {isActive ? (
                          <Loader2 size={16} className="mc-spin" />
                        ) : isDone ? (
                          <CheckCircle2 size={16} />
                        ) : (
                          <div className="mc-step-dot" />
                        )}
                      </div>
                      <span className="mc-step-label">{stepLabel}</span>
                      <span className="mc-step-help-wrap">
                        <button
                          type="button"
                          className="mc-step-help"
                          aria-label={`Qué significa ${stepLabel}`}
                          aria-describedby="mc-steps-help-panel"
                          onMouseEnter={() =>
                            setStepHelpTip(s as PipelineStepKey)
                          }
                          onFocus={() => setStepHelpTip(s as PipelineStepKey)}
                          onBlur={() => setStepHelpTip(null)}
                        >
                          <HelpCircle size={14} aria-hidden />
                        </button>
                      </span>
                    </div>
                  )
                },
              )}
            </div>
            <p
              id="mc-steps-help-panel"
              className={`mc-steps-help-slot${stepHelpTip ? ' is-active' : ''}`}
              role="status"
              aria-live="polite"
            >
              {stepHelpTip
                ? PIPELINE_STEP_HELP[stepHelpTip]
                : 'Pasa el cursor sobre (?) para ver qué hace cada etapa.'}
            </p>
            {(pipelineStatus !== 'idle' || isCancelling) && (
              <p
                className={`mc-pipeline-status${isCancelling ? ' is-cancelling-status' : ''}`}
              >
                {pipelineStatusLabel}
              </p>
            )}
            <div className="mc-progress-stack">
              {(pipelineStatus === 'processing_text' ||
                pipelineStatus === 'awaiting_graph_confirmation' ||
                pipelineStatus === 'processing_graph' ||
                pipelineStatus === 'graph_ready' ||
                pipelineStatus === 'partial_error' ||
                pipelineStatus === 'error') && (
                <div className="mc-progress-card">
                  <div className="mc-progress-header">
                    <span>Extracción de texto</span>
                    <strong>
                      {pipelineProgressDisplay.textCardPercentLabel}
                    </strong>
                  </div>

                  <div className="mc-progress-bar">
                    <div
                      className="mc-progress-fill"
                      style={{
                        width: `${pipelineProgressDisplay.textCardBarWidth}%`,
                      }}
                    />
                  </div>

                  <p className="mc-progress-summary">
                    {textSuccessCount} de {textProgress.total} documento(s)
                    procesado(s) correctamente.
                  </p>

                  {textProgress.failed.length > 0 && (
                    <div className="mc-progress-errors">
                      <div className="mc-progress-errors-header">
                        <strong>No pasaron extracción: </strong>
                        <span>{textProgress.failed.length} archivo(s)</span>
                      </div>

                      <ul className="mc-progress-errors-list">
                        {textProgress.failed.map((doc) => (
                          <li key={`text-${doc.filename}`}>
                            {doc.filename}
                            {doc.reason ? ` — ${doc.reason}` : ''}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}

              {(pipelineStatus === 'processing_graph' ||
                pipelineStatus === 'graph_ready' ||
                pipelineStatus === 'partial_error' ||
                pipelineStatus === 'error') && (
                <div className="mc-progress-card">
                  <div className="mc-progress-header">
                    <span>Construcción del grafo</span>
                    <strong>
                      {pipelineProgressDisplay.graphCardPercentLabel}
                    </strong>
                  </div>

                  <div className="mc-progress-bar">
                    <div
                      className="mc-progress-fill"
                      style={{
                        width: `${pipelineProgressDisplay.graphCardBarWidth}%`,
                      }}
                    />
                  </div>

                  <p className="mc-progress-summary">
                    {graphSuccessCount} de {graphProgress.total} etapa(s)
                    completada(s) correctamente.
                  </p>

                  {graphProgress.failed.length > 0 && (
                    <div className="mc-progress-errors">
                      <div className="mc-progress-errors-header">
                        <strong>No pasaron construcción del grafo: </strong>
                        <span>{graphProgress.failed.length} archivo(s)</span>
                      </div>

                      <ul className="mc-progress-errors-list">
                        {graphProgress.failed.map((doc) => (
                          <li key={`graph-${doc.filename}`}>
                            {doc.filename}
                            {doc.reason ? ` — ${doc.reason}` : ''}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>
            {pipelineError &&
              (pipelineNoticeKind !== 'none' ||
                (resolvedEtapa === 'pipeline' &&
                  pipelineStatus === 'idle')) && (
                <div
                  className={`mc-pipeline-notice mc-pipeline-notice--${
                    pipelineNoticeKind !== 'none' ? pipelineNoticeKind : 'error'
                  }`}
                >
                  {pipelineNoticeKind === 'error' ? (
                    <AlertCircle size={14} />
                  ) : (
                    <CheckCircle2 size={14} />
                  )}{' '}
                  {pipelineError}
                </div>
              )}
            {pipelineStatus === 'idle' && (
              <div className="mc-entity-options">
                <p className="mc-entity-title">Entidades a extraer</p>

                <div className="mc-entity-grid">
                  {ENTITY_OPTIONS.map((entity) => (
                    <label key={entity} className="mc-entity-option">
                      <input
                        type="checkbox"
                        checked={selectedEntities.includes(entity)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            updateSelectedEntities((prev) => [...prev, entity])
                          } else {
                            updateSelectedEntities((prev) =>
                              prev.filter((item) => item !== entity),
                            )
                          }
                        }}
                        disabled={isCancelling}
                      />
                      <span>{entity}</span>
                    </label>
                  ))}
                </div>

                <p className="mc-entity-help">
                  Si no seleccionas ninguna, se usarán las entidades por
                  defecto.
                </p>
              </div>
            )}

            <div className="mc-footer">
              {pipelineStatus === 'idle' && (
                <>
                  <button
                    className="mc-btn-cancel"
                    type="button"
                    onClick={handleCancel}
                    disabled={isCancelling}
                  >
                    {cancelButtonLabel}
                  </button>

                  <button
                    className="mc-btn-upload"
                    onClick={handleIniciarPipeline}
                    disabled={isCancelling || isSubmittingPipeline}
                  >
                    <Network size={14} />{' '}
                    {isSubmittingPipeline ? 'Iniciando...' : 'Generar grafo'}
                  </button>
                </>
              )}

              {pipelineStatus === 'queued' && (
                <button
                  className="mc-btn-cancel"
                  type="button"
                  onClick={handleCancel}
                  disabled={isCancelling}
                >
                  {cancelButtonLabel}
                </button>
              )}

              {(isPipelineRunning ||
                pipelineStatus === 'awaiting_graph_confirmation') && (
                <>
                  <button
                    className="mc-btn-cancel"
                    type="button"
                    onClick={handleCancel}
                    disabled={isCancelling}
                  >
                    {cancelButtonLabel}
                  </button>

                  {pipelineStatus === 'awaiting_graph_confirmation' && (
                    <button
                      className="mc-btn-upload"
                      type="button"
                      onClick={handleContinuarConGrafo}
                      disabled={isCancelling}
                    >
                      <Network size={14} /> Continuar con grafo
                    </button>
                  )}
                </>
              )}

              {(pipelineStatus === 'graph_ready' ||
                pipelineStatus === 'partial_error') && (
                <button
                  className="mc-btn-upload"
                  onClick={handleFinalizarExito}
                >
                  <CheckCircle2 size={14} /> Finalizar
                </button>
              )}

              {pipelineStatus === 'error' && (
                <>
                  <button
                    className="mc-btn-cancel"
                    type="button"
                    onClick={handleCancel}
                    disabled={isCancelling}
                  >
                    {cancelButtonLabel}
                  </button>

                  <button
                    className="mc-btn-upload"
                    type="button"
                    onClick={handleIniciarPipeline}
                    disabled={isCancelling || isSubmittingPipeline}
                  >
                    {isSubmittingPipeline ? 'Iniciando...' : 'Reintentar'}
                  </button>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default ModalCarga
