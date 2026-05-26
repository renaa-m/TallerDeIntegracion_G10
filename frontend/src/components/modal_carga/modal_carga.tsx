import { useState, useRef, useEffect, useCallback } from 'react'
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

// --- Constantes de Persistencia ---
const ACTIVE_COLLECTION_KEY = 'active_collection_id'
const MODAL_ETAPA_KEY = 'modal_carga_etapa'

interface ModalCargaProps {
  isOpen: boolean
  onClose: () => void
  darkMode?: boolean
  onUploadSuccess?: () => void
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
    'Algunos documentos no pudieron extraerse. ¿Quieres continuar con el grafo?',
  graph_ready: '¡Grafo generado correctamente!',
  partial_error:
    'Procesamiento con advertencias: parte del grafo se generó; revisa el mensaje debajo.',
  cancelled: 'Procesamiento cancelado.',
  error: 'Ocurrió un error durante el procesamiento.',
}

/** El backend usa ``cancelled``; en la UI equivalen a “listo para generar de nuevo”. */
function pipelineStatusFromApi(raw: string | undefined): PipelineStatus {
  if (raw === 'cancelled') return 'idle'
  if (
    raw === 'idle' ||
    raw === 'processing_text' ||
    raw === 'processing_graph' ||
    raw === 'awaiting_graph_confirmation' ||
    raw === 'graph_ready' ||
    raw === 'error'
  ) {
    return raw
  }
  return 'idle'
}

const API_BASE =
  import.meta.env.VITE_API_URL?.replace(/\/$/, '') || 'http://localhost:8080'

const ModalCarga = ({
  isOpen,
  onClose,
  darkMode = false,
  onUploadSuccess,
}: ModalCargaProps) => {
  const { getAccessTokenSilently } = useAuth0()
  const navigate = useNavigate()

  // --- Estados ---
  const [files, setFiles] = useState<File[]>([])
  const [isDragging, setIsDragging] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [uploadedCount, setUploadedCount] = useState(0)
  const [nombreColeccion, setNombreColeccion] = useState('')
  const [error, setError] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [etapa, setEtapa] = useState<Etapa>('subida')
  const [pipelineStatus, setPipelineStatus] = useState<PipelineStatus>('idle')
  const [pipelineError, setPipelineError] = useState('')
  const [activeCollectionId, setActiveCollectionId] = useState<string | null>(
    localStorage.getItem(ACTIVE_COLLECTION_KEY),
  )
  const [textProgress, setTextProgress] = useState<StepProgress>(EMPTY_PROGRESS)
  const [graphProgress, setGraphProgress] =
    useState<StepProgress>(EMPTY_PROGRESS)

  const isUploadingLocked = isUploading
  const isPipelineRunning =
    pipelineStatus === 'processing_text' ||
    pipelineStatus === 'processing_graph'

  const abortControllersRef = useRef<AbortController[]>([])

  // --- 1. Sincronización al Recargar ---
  useEffect(() => {
    const syncStatus = async () => {
      const savedId = localStorage.getItem(ACTIVE_COLLECTION_KEY)
      const savedEtapa = localStorage.getItem(MODAL_ETAPA_KEY) as Etapa

      if (savedId && isOpen) {
        setActiveCollectionId(savedId)
        if (savedEtapa) setEtapa(savedEtapa)

        try {
          const token = await getAccessTokenSilently()
          const res = await fetch(`${API_BASE}/api/collections/${savedId}`, {
            headers: { Authorization: `Bearer ${token}` },
          })
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
            setPipelineStatus(pipelineStatusFromApi(data.processing_status))
            if (
              data.processing_status === 'partial_error' ||
              data.processing_status === 'error'
            ) {
              setPipelineError(data.processing_error_message ?? '')
            }
          }
        } catch (e) {
          console.error('Error al recuperar estado tras recarga:', e)
        }
      }
    }
    syncStatus()
  }, [isOpen, getAccessTokenSilently])

  // --- 2. Lógica de Cierre y Cancelación Real (CORREGIDO) ---
  const handleClose = useCallback(async () => {
    abortControllersRef.current.forEach((controller) => controller.abort())
    abortControllersRef.current = []
    setError('')
    if (activeCollectionId) {
      try {
        const token = await getAccessTokenSilently()

        if (isPipelineRunning) {
          await fetch(
            `${API_BASE}/api/collections/${activeCollectionId}/process/cancel`,
            {
              method: 'POST',
              headers: { Authorization: `Bearer ${token}` },
            },
          )
        }

        await fetch(`${API_BASE}/api/collections/${activeCollectionId}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        })
      } catch (err) {
        console.error('Error abortando colección:', err)
      }
    }

    localStorage.removeItem(ACTIVE_COLLECTION_KEY)
    localStorage.removeItem(MODAL_ETAPA_KEY)
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

    navigate('/landing_page')
    onClose()
  }, [
    activeCollectionId,
    getAccessTokenSilently,
    isPipelineRunning,
    navigate,
    onClose,
  ])

  // --- 3. Polling de Pipeline (Sigue funcionando tras recarga) ---
  useEffect(() => {
    if (
      etapa !== 'pipeline' ||
      !activeCollectionId ||
      ['graph_ready', 'partial_error', 'error', 'idle'].includes(pipelineStatus)
    )
      return

    const interval = window.setInterval(async () => {
      try {
        const token = await getAccessTokenSilently()
        const res = await fetch(
          `${API_BASE}/api/collections/${activeCollectionId}`,
          {
            headers: { Authorization: `Bearer ${token}` },
          },
        )
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
        if (
          status === 'graph_ready' ||
          status === 'partial_error' ||
          status === 'error' ||
          status === 'awaiting_graph_confirmation' ||
          data.processing_status === 'cancelled'
        ) {
          if (status === 'error' || status === 'partial_error') {
            setPipelineError(
              data.processing_error_message ??
                (status === 'error'
                  ? 'Error desconocido'
                  : 'Procesamiento incompleto'),
            )
          }
          if (data.processing_status === 'cancelled') {
            setPipelineError('')
          }
          clearInterval(interval)
        }
      } catch (e) {
        console.error('Error en polling:', e)
      }
    }, 3000)
    return () => clearInterval(interval)
  }, [etapa, activeCollectionId, pipelineStatus, getAccessTokenSilently])

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

      setActiveCollectionId(collection.id)
      localStorage.setItem(ACTIVE_COLLECTION_KEY, collection.id)
      localStorage.setItem(MODAL_ETAPA_KEY, 'subida')

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
        if (upRes.ok) {
          uploaded++
          setUploadedCount(uploaded)
        }
      }

      if (uploaded === 0) throw new Error('No se subieron archivos.')

      setEtapa('pipeline')
      localStorage.setItem(MODAL_ETAPA_KEY, 'pipeline')
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
    if (!activeCollectionId) return
    setPipelineError('')
    try {
      const token = await getAccessTokenSilently()
      const res = await fetch(
        `${API_BASE}/api/collections/${activeCollectionId}/process`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        },
      )
      if (!res.ok) throw new Error('Error al iniciar Wukong')
      setPipelineStatus('processing_text')
    } catch (e: unknown) {
      setPipelineError(
        e instanceof Error ? e.message : 'Error al iniciar el procesamiento',
      )
    }
  }

  // Finalización exitosa o con advertencias: no borra la colección en servidor.
  const handleFinalizarExito = () => {
    localStorage.removeItem(ACTIVE_COLLECTION_KEY)
    localStorage.removeItem(MODAL_ETAPA_KEY)
    onClose()
    navigate(`/user/colecciones/${activeCollectionId}/buscador`)
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

  const textSuccessCount = textProgress.processed

  const graphSuccessCount = graphProgress.processed

  const handleContinuarConGrafo = async () => {
    if (!activeCollectionId) return

    try {
      const token = await getAccessTokenSilently()
      const res = await fetch(
        `${API_BASE}/api/collections/${activeCollectionId}/process/continue-graph`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        },
      )

      if (!res.ok) throw new Error('Error al continuar con el grafo')

      setPipelineStatus('processing_graph')
    } catch (e: unknown) {
      setPipelineError(
        e instanceof Error ? e.message : 'Error al continuar con el grafo',
      )
    }
  }

  if (!isOpen) return null

  return (
    <div className="mc-overlay" onClick={handleClose}>
      <div
        className={`mc-panel${darkMode ? ' dark' : ''}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mc-header">
          <div>
            <h2 className="mc-title">
              {etapa === 'subida' ? 'Añadir fuentes' : 'Procesar grafo'}
            </h2>
            <p className="mc-subtitle">
              {etapa === 'subida'
                ? 'Sube documentos para indexar'
                : 'Construye el grafo de conocimiento'}
            </p>
          </div>
          <button className="mc-close" onClick={handleClose} disabled={false}>
            <X size={18} />
          </button>
        </div>

        {etapa === 'subida' ? (
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
                onClick={handleClose}
                disabled={false}
              >
                Cancelar
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
                    s === pipelineStatus && pipelineStatus !== 'graph_ready'
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
            <p className="mc-pipeline-status">
              {PIPELINE_LABELS[pipelineStatus] ?? pipelineStatus}
            </p>
            <div className="mc-progress-stack">
              {(pipelineStatus === 'processing_text' ||
                pipelineStatus === 'processing_graph' ||
                pipelineStatus === 'graph_ready' ||
                pipelineStatus === 'partial_error' ||
                pipelineStatus === 'error') && (
                <div className="mc-progress-card">
                  <div className="mc-progress-header">
                    <span>Extracción de texto</span>
                    <strong>{textProgressPercent}%</strong>
                  </div>

                  <div className="mc-progress-bar">
                    <div
                      className="mc-progress-fill"
                      style={{ width: `${textProgressPercent}%` }}
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
            {pipelineError && (
              <div className="mc-pipeline-error">
                <AlertCircle size={14} /> {pipelineError}
              </div>
            )}
            <div className="mc-footer">
              {pipelineStatus === 'idle' && (
                <button
                  className="mc-btn-upload"
                  onClick={handleIniciarPipeline}
                >
                  <Network size={14} /> Generar grafo
                </button>
              )}
              {pipelineStatus === 'awaiting_graph_confirmation' && (
                <>
                  <button
                    className="mc-btn-cancel"
                    type="button"
                    onClick={handleClose}
                  >
                    Abortar
                  </button>

                  <button
                    className="mc-btn-upload"
                    type="button"
                    onClick={handleContinuarConGrafo}
                  >
                    <Network size={14} /> Continuar con grafo
                  </button>
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
                    onClick={handleClose}
                  >
                    Abortar colección
                  </button>
                  <button
                    className="mc-btn-upload"
                    type="button"
                    onClick={handleIniciarPipeline}
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
