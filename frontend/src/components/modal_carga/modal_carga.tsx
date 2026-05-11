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

interface ModalCargaProps {
  isOpen: boolean
  onClose: () => void
  darkMode?: boolean
  coleccionId?: string
  onUploadSuccess?: () => void
}

type Etapa = 'subida' | 'pipeline'
type PipelineStatus =
  | 'idle'
  | 'processing_text'
  | 'processing_graph'
  | 'graph_ready'
  | 'error'

const PIPELINE_LABELS: Record<PipelineStatus, string> = {
  idle: 'Listo para procesar',
  processing_text: 'Extrayendo texto de los documentos...',
  processing_graph: 'Construyendo grafo con Wukong...',
  graph_ready: '¡Grafo generado correctamente!',
  error: 'Ocurrió un error durante el procesamiento.',
}

const API_BASE =
  import.meta.env.VITE_API_URL?.replace(/\/$/, '') || 'http://localhost:8080'

const ModalCarga = ({
  isOpen,
  onClose,
  darkMode = false,
  coleccionId,
  onUploadSuccess,
}: ModalCargaProps) => {
  const { getAccessTokenSilently } = useAuth0()
  const navigate = useNavigate()

  // --- Estados ---
  const [files, setFiles] = useState<File[]>([])
  const [isDragging, setIsDragging] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [uploadedCount, setUploadedCount] = useState(0)
  const [failedCount, setFailedCount] = useState(0)
  const [nombreColeccion, setNombreColeccion] = useState('')
  const [error, setError] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [etapa, setEtapa] = useState<Etapa>('subida')
  const [pipelineStatus, setPipelineStatus] = useState<PipelineStatus>('idle')
  const [pipelineError, setPipelineError] = useState('')
  const [activeCollectionId, setActiveCollectionId] = useState<string | null>(
    null,
  )

  const isLocked =
    isUploading ||
    pipelineStatus === 'processing_text' ||
    pipelineStatus === 'processing_graph'

  // --- Refs y Constantes ---
  const abortControllersRef = useRef<AbortController[]>([])
  const activeCollectionIdRef = useRef<string | null>(null)
  const isUploadingRef = useRef(false)
  const UPLOAD_IN_PROGRESS_KEY = 'upload_in_progress_collection_id'

  useEffect(() => {
    isUploadingRef.current = isUploading
  }, [isUploading])
  useEffect(() => {
    activeCollectionIdRef.current = activeCollectionId
  }, [activeCollectionId])

  // --- Lógica de Cierre con Redirección al Main ---
  const handleClose = useCallback(() => {
    if (isLocked) return

    // Si se cancela en etapa de subida, volvemos al main
    if (etapa === 'subida') {
      navigate('/landing_page')
    }

    // Reset de estados
    setFiles([])
    setNombreColeccion('')
    setError('')
    setEtapa('subida')
    setPipelineStatus('idle')
    setPipelineError('')
    setIsUploading(false)
    setActiveCollectionId(null)
    sessionStorage.removeItem(UPLOAD_IN_PROGRESS_KEY)
    
    onClose()
  }, [onClose, isLocked, etapa, navigate])

  // --- Lógica de Limpieza al Recargar ---
  useEffect(() => {
    const cleanupInterruptedUpload = async () => {
      const interruptedId = sessionStorage.getItem(UPLOAD_IN_PROGRESS_KEY)
      if (!interruptedId) return

      sessionStorage.removeItem(UPLOAD_IN_PROGRESS_KEY)
      try {
        const token = await getAccessTokenSilently()
        await fetch(`${API_BASE}/api/collections/${interruptedId}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        })
      } catch (err) {
        console.error('Limpieza fallida tras recarga:', err)
      }
      navigate('/landing_page')
    }

    cleanupInterruptedUpload()
  }, [getAccessTokenSilently, navigate])

  // --- Manejo de Esc y BeforeUnload ---
  useEffect(() => {
    if (!isOpen) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isLocked) handleClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [isOpen, handleClose, isLocked])

  useEffect(() => {
    const handleBeforeUnload = () => {
      if (!isUploadingRef.current || !activeCollectionIdRef.current) return
      sessionStorage.setItem(
        UPLOAD_IN_PROGRESS_KEY,
        activeCollectionIdRef.current,
      )
      abortControllersRef.current.forEach((c) => c.abort())
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [])

  // --- Polling de Pipeline ---
  useEffect(() => {
    if (
      etapa !== 'pipeline' ||
      !activeCollectionId ||
      ['graph_ready', 'error', 'idle'].includes(pipelineStatus)
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
        const status: PipelineStatus = data.processing_status ?? 'idle'
        setPipelineStatus(status)
        if (status === 'graph_ready' || status === 'error') {
          if (status === 'error')
            setPipelineError(
              data.processing_error_message ?? 'Error desconocido',
            )
          clearInterval(interval)
        }
      } catch (e) {
        console.error('Error en polling:', e)
      }
    }, 3000)
    return () => clearInterval(interval)
  }, [etapa, activeCollectionId, pipelineStatus, getAccessTokenSilently])

  const createCollection = async () => {
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
    return await res.json()
  }

  const uploadOneFile = async (
    file: File,
    collectionId: string,
    signal?: AbortSignal,
  ) => {
    const token = await getAccessTokenSilently()
    const formData = new FormData()
    formData.append('file', file)
    const res = await fetch(
      `${API_BASE}/api/documentos/upload?coleccion_id=${collectionId}`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
        signal,
      },
    )
    if (!res.ok) throw new Error(`Error en ${file.name}`)
    return await res.json()
  }

  const handleUpload = async () => {
    if (files.length === 0) return
    setIsUploading(true)
    setError('')
    setUploadedCount(0)
    setFailedCount(0)

    try {
      const collection = await createCollection()
      setActiveCollectionId(collection.id)
      sessionStorage.setItem(UPLOAD_IN_PROGRESS_KEY, collection.id)

      let uploaded = 0
      for (const file of files) {
        const controller = new AbortController()
        abortControllersRef.current.push(controller)
        try {
          await uploadOneFile(file, collection.id, controller.signal)
          uploaded++
          setUploadedCount(uploaded)
        } catch (e) {
          setFailedCount((prev) => prev + 1)
        }
      }

      if (uploaded === 0) throw new Error('No se subieron archivos con éxito.')

      sessionStorage.removeItem(UPLOAD_IN_PROGRESS_KEY)
      if (onUploadSuccess) onUploadSuccess()
      setEtapa('pipeline')
    } catch (err: any) {
      setError(err.message || 'Error en la carga')
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
    } catch (e: any) {
      setPipelineError(e.message)
    }
  }

  if (!isOpen) return null

  return (
    <div className="mc-overlay" onClick={isLocked ? undefined : handleClose}>
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
          <button
            className="mc-close"
            onClick={handleClose}
            disabled={isLocked}
          >
            <X size={18} />
          </button>
        </div>

        {etapa === 'subida' ? (
          <>
            <div
              className={`mc-dropzone${isDragging ? ' dragging' : ''} ${isLocked ? ' disabled' : ''}`}
              onDragOver={(e) => {
                e.preventDefault()
                if (!isLocked) setIsDragging(true)
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={(e) => {
                e.preventDefault()
                setIsDragging(false)
                if (!isLocked) setFiles(Array.from(e.dataTransfer.files))
              }}
              onClick={() => {
                if (!isLocked) fileInputRef.current?.click()
              }}
            >
              <input
                type="file"
                multiple
                hidden
                ref={fileInputRef}
                accept=".pdf,.txt"
                onChange={(e) => setFiles(Array.from(e.target.files || []))}
                disabled={isLocked}
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
                      disabled={isLocked}
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
                disabled={isLocked}
              />
            </div>

            <div className="mc-footer">
              <button
                className="mc-btn-cancel"
                onClick={handleClose}
                disabled={isLocked}
              >
                Cancelar
              </button>
              <button
                className="mc-btn-upload"
                disabled={
                  files.length === 0 || isLocked || !nombreColeccion.trim()
                }
                onClick={handleUpload}
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
                        pipelineStatus === 'graph_ready')) ||
                    (s === 'processing_graph' &&
                      pipelineStatus === 'graph_ready') ||
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
              {PIPELINE_LABELS[pipelineStatus]}
            </p>
            {pipelineError && (
              <div className="mc-pipeline-error">
                <AlertCircle size={14} /> {pipelineError}
              </div>
            )}
            <div className="mc-footer">
              {pipelineStatus === 'idle' && (
                <>
                  <button className="mc-btn-cancel" onClick={handleClose}>
                    Luego
                  </button>
                  <button
                    className="mc-btn-upload"
                    onClick={handleIniciarPipeline}
                  >
                    <Network size={14} /> Generar grafo
                  </button>
                </>
              )}
              {pipelineStatus === 'graph_ready' && (
                <button
                  className="mc-btn-upload"
                  onClick={() => {
                    handleClose()
                    navigate(`/user/colecciones/${activeCollectionId}/buscador`)
                  }}
                >
                  <CheckCircle2 size={14} /> Finalizar
                </button>
              )}
              {pipelineStatus === 'error' && (
                <button
                  className="mc-btn-upload"
                  onClick={handleIniciarPipeline}
                >
                  Reintentar
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default ModalCarga