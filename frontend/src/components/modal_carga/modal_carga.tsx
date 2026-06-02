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
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import './modal_carga.css'
import {
  ACTIVE_COLLECTION_KEY,
  MODAL_ETAPA_KEY,
  clearActiveCollectionStorage,
  clearActiveCollectionStorageIfMatch,
  isPipelineInProgress,
  isPipelineRunning as isBackendPipelineRunning,
  resolveModalCollectionId,
  shouldOpenPipelineModal,
} from '../../lib/collection_processing'

interface ModalCargaProps {
  isOpen: boolean
  onClose: () => void
  darkMode?: boolean
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
  idle: 'Listo para procesar',
  processing_text: 'Extrayendo texto de los documentos...',
  processing_graph: 'Construyendo grafo con Wukong...',
  awaiting_graph_confirmation:
    'Algunos documentos no se extrajeron. El grafo usará solo los que sí pasaron.',
  graph_ready: '¡Grafo generado correctamente!',
  partial_error: '¡Grafo generado! Revisa qué documentos quedaron fuera.',
  cancelled: 'Procesamiento cancelado.',
  error: 'Ocurrió un error durante el procesamiento.',
}

/** El backend usa ``cancelled``; en la UI equivalen a “listo para generar de nuevo”. */
function pipelineStatusFromApi(raw: string | undefined): PipelineStatus {
  if (raw === 'cancelled' || raw === 'queued') return 'idle'
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

const API_BASE =
  import.meta.env.VITE_API_URL?.replace(/\/$/, '') || ''

const ModalCarga = ({
  isOpen,
  onClose,
  darkMode = false,
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
  const [nombreColeccion, setNombreColeccion] = useState('')
  const [error, setError] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)
  /** ID de colección en creación/subida (sincrónico; el state puede ir retrasado). */
  const uploadCollectionIdRef = useRef<string | null>(null)

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
    return etapa
  }, [forcePipelineEtapa, scopeCollectionId, etapa])
  const isPipelineRunning =
    pipelineStatus === 'processing_text' ||
    pipelineStatus === 'processing_graph'

  const abortControllersRef = useRef<AbortController[]>([])

  const persistBackgroundProcessing = useCallback((collectionId: string) => {
    localStorage.setItem(ACTIVE_COLLECTION_KEY, collectionId)
    localStorage.setItem(MODAL_ETAPA_KEY, 'pipeline')
  }, [])

  const resetUploadForm = useCallback(() => {
    setFiles([])
    setNombreColeccion('')
    setError('')
    setEtapa('subida')
    setPipelineStatus('idle')
    setPipelineError('')
    setActiveCollectionId(null)
    setIsUploading(false)
    setUploadedCount(0)
    setTextProgress(EMPTY_PROGRESS)
    setGraphProgress(EMPTY_PROGRESS)
    uploadCollectionIdRef.current = null
    setIsCancelling(false)
  }, [])

  // --- 1. Sincronización: colección de la ruta o sesión en /nueva ---
  useEffect(() => {
    const syncStatus = async () => {
      if (!isOpen || isCancelling) return

      const collectionId =
        scopeCollectionId && scopeCollectionId !== 'nueva'
          ? scopeCollectionId
          : nuevaSessionCollectionId

      if (!collectionId) return

      if (scopeCollectionId && scopeCollectionId !== 'nueva') {
        setActiveCollectionId(scopeCollectionId)
      }

      try {
        const token = await getAccessTokenSilently()
        const res = await fetch(`${API_BASE}/api/collections/${collectionId}`, {
          headers: { Authorization: `Bearer ${token}` },
        })
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
          setPipelineStatus(status)
          onProcessingChange?.(isPipelineInProgress(data.processing_status))

          if (isPipelineInProgress(data.processing_status)) {
            localStorage.setItem(ACTIVE_COLLECTION_KEY, collectionId)
            localStorage.setItem(MODAL_ETAPA_KEY, 'pipeline')
          }

          if (
            data.processing_status === 'partial_error' ||
            data.processing_status === 'error' ||
            data.processing_status === 'awaiting_graph_confirmation'
          ) {
            setPipelineError(data.processing_error_message ?? '')
          } else if (data.processing_status === 'graph_ready') {
            setPipelineError('')
          } else if (status !== 'error' && status !== 'partial_error') {
            setPipelineError('')
          }

          const savedId = localStorage.getItem(ACTIVE_COLLECTION_KEY)
          const savedEtapa = localStorage.getItem(MODAL_ETAPA_KEY) as Etapa
          if (
            !isPipelineInProgress(data.processing_status) &&
            savedId === collectionId
          ) {
            const esperandoGrafo =
              data.processing_status === 'idle' && savedEtapa === 'pipeline'
            if (!esperandoGrafo) {
              clearActiveCollectionStorage()
              onProcessingChange?.(false)
            }
          }

          let documentCount = 0
          if ((data.processing_status ?? 'idle') === 'idle') {
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

          const openPipeline =
            forcePipelineEtapa ||
            shouldOpenPipelineModal(data.processing_status, {
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
  ])

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

  /** X u overlay: cerrar sin borrar (pipeline activo o en espera → segundo plano). */
  const handleDismiss = useCallback(() => {
    if (isUploading || isCancelling) return

    const collectionId = uploadCollectionIdRef.current ?? resolvedCollectionId

    if (
      scopeCollectionId === 'nueva' &&
      !collectionId &&
      resolvedEtapa === 'subida'
    ) {
      clearActiveCollectionStorage()
      onClose()
      if (landingUserId) {
        navigate(`/landing-page/${landingUserId}`, { replace: true })
      }
      return
    }

    if (
      resolvedEtapa === 'pipeline' &&
      isPipelineInProgress(pipelineStatus) &&
      resolvedCollectionId
    ) {
      persistBackgroundProcessing(resolvedCollectionId)
      onClose()
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
    persistBackgroundProcessing,
    pipelineStatus,
    scopeCollectionId,
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
        if (isBackendPipelineRunning(pipelineStatus)) {
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

  // --- 3. Polling de Pipeline (solo con modal abierto y colección de la ruta) ---
  useEffect(() => {
    if (
      !isOpen ||
      isCancelling ||
      resolvedEtapa !== 'pipeline' ||
      !resolvedCollectionId ||
      (scopeCollectionId &&
        scopeCollectionId !== 'nueva' &&
        resolvedCollectionId !== scopeCollectionId) ||
      ['graph_ready', 'partial_error', 'error', 'idle'].includes(pipelineStatus)
    )
      return

    const collectionId = resolvedCollectionId
    const interval = window.setInterval(async () => {
      try {
        const token = await getAccessTokenSilently()
        const res = await fetch(`${API_BASE}/api/collections/${collectionId}`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (res.status === 404) {
          clearActiveCollectionStorageIfMatch(collectionId)
          clearInterval(interval)
          resetUploadForm()
          onProcessingChange?.(false)
          onClose()
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
        setPipelineStatus(status)
        onProcessingChange?.(isPipelineInProgress(data.processing_status))
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
          if (
            status === 'graph_ready' ||
            status === 'partial_error' ||
            status === 'error' ||
            data.processing_status === 'cancelled'
          ) {
            onProcessingChange?.(false)
          }
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
    pipelineStatus,
    getAccessTokenSilently,
    onProcessingChange,
    onClose,
    resetUploadForm,
  ])

  const handleUpload = async () => {
    if (files.length === 0) return
    setIsUploading(true)
    setError('')

    try {
      const token = await getAccessTokenSilently()
      const res = await fetch(`${API_BASE}/api/collections`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: nombreColeccion || 'Nueva colección',
          description: '',
        }),
      })
      if (!res.ok) throw new Error('Error al crear colección')
      const collection = await res.json()

      uploadCollectionIdRef.current = collection.id
      setActiveCollectionId(collection.id)

      let uploaded = 0
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
        }
      }

      if (uploaded === 0) throw new Error('No se subieron archivos.')

      setEtapa('pipeline')
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
      setIsUploading(false)
    }
  }

  const handleIniciarPipeline = async () => {
    if (!resolvedCollectionId) return
    setPipelineError('')
    try {
      const token = await getAccessTokenSilently()
      const res = await fetch(
        `${API_BASE}/api/collections/${resolvedCollectionId}/process`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
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
      setPipelineStatus(pipelineStatusFromApi(data.processing_status))
      if (isPipelineInProgress(data.processing_status)) {
        persistBackgroundProcessing(resolvedCollectionId)
      }
      onProcessingChange?.(isPipelineInProgress(data.processing_status))
    } catch (e: unknown) {
      setPipelineError(
        e instanceof Error ? e.message : 'Error al iniciar el procesamiento',
      )
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

  const getProgressPercent = (progress: StepProgress) => {
    if (progress.total <= 0) return 0
    return Math.min(
      100,
      Math.round((progress.processed / progress.total) * 100),
    )
  }

  const textProgressPercent = getProgressPercent(textProgress)
  const graphProgressPercent = getProgressPercent(graphProgress)

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
      const res = await fetch(
        `${API_BASE}/api/collections/${resolvedCollectionId}/process/continue-graph`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
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

      setPipelineStatus(pipelineStatusFromApi(data.processing_status))
      if (isPipelineInProgress(data.processing_status)) {
        persistBackgroundProcessing(resolvedCollectionId)
      }
      onProcessingChange?.(isPipelineInProgress(data.processing_status))
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
      onClick={isUploadingLocked ? undefined : handleDismiss}
    >
      <div
        className={`mc-panel${darkMode ? ' dark' : ''}${isCancelling ? ' is-cancelling' : ''}`}
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
          <div>
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
            disabled={isUploadingLocked}
            aria-label="Cerrar"
            title={
              isCancelling
                ? cancellingMessage
                : isUploading
                  ? 'Espera a que termine la subida o usa Cancelar'
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
                if (!isUploadingLocked)
                  setFiles(Array.from(e.dataTransfer.files))
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
                onChange={(e) => setFiles(Array.from(e.target.files || []))}
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
              <p className="mc-drop-sub">PDF o TXT · Máx. 50 MB</p>
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
                Subiendo {uploadedCount} de {files.length}...
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
            <div className="mc-steps">
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
                  return (
                    <div
                      key={s}
                      className={`mc-step ${isActive ? 'active' : ''} ${isDone ? 'done' : ''}`}
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
                    </div>
                  )
                },
              )}
            </div>
            <p
              className={`mc-pipeline-status${isCancelling ? ' is-cancelling-status' : ''}`}
            >
              {pipelineStatusLabel}
            </p>
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
                      {pipelineStatus === 'processing_text'
                        ? `${textProgressPercent}%`
                        : pipelineStatus === 'awaiting_graph_confirmation'
                          ? 'Con advertencias'
                          : 'Completada'}
                    </strong>
                  </div>

                  <div className="mc-progress-bar">
                    <div
                      className="mc-progress-fill"
                      style={{
                        width:
                          pipelineStatus === 'processing_text'
                            ? `${textProgressPercent}%`
                            : '100%',
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
                    <strong>{graphProgressPercent}%</strong>
                  </div>

                  <div className="mc-progress-bar">
                    <div
                      className="mc-progress-fill"
                      style={{ width: `${graphProgressPercent}%` }}
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
                    disabled={isCancelling}
                  >
                    <Network size={14} /> Generar grafo
                  </button>
                </>
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
                    disabled={isCancelling}
                  >
                    Reintentar
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
