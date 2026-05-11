import { useState, useRef, useEffect, useCallback } from 'react'
import { useAuth0 } from '@auth0/auth0-react'
import { X, CloudUpload, FileText, Trash2, Loader2, Network, CheckCircle2, AlertCircle } from 'lucide-react'
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
type PipelineStatus = 'idle' | 'processing_text' | 'processing_graph' | 'graph_ready' | 'error'

const PIPELINE_LABELS: Record<PipelineStatus, string> = {
  idle: 'Listo para procesar',
  processing_text: 'Extrayendo texto de los documentos...',
  processing_graph: 'Construyendo grafo con Wukong...',
  graph_ready: '¡Grafo generado correctamente!',
  error: 'Ocurrió un error durante el procesamiento.',
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const ModalCarga = ({ isOpen, onClose, darkMode = false, onUploadSuccess }: ModalCargaProps) => {
  const { getAccessTokenSilently } = useAuth0()
  const navigate = useNavigate()
  const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8080'

  // --- Estados Originales ---
  const [files, setFiles] = useState<File[]>([])
  const [isDragging, setIsDragging] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [nombreColeccion, setNombreColeccion] = useState('')
  const [error, setError] = useState('')
  const [uploadedCount, setUploadedCount] = useState(0)
  const [failedCount, setFailedCount] = useState(0)
  const fileInputRef = useRef<HTMLInputElement>(null)
  
  // --- Estados de Pipeline ---
  const [etapa, setEtapa] = useState<Etapa>('subida')
  const [pipelineStatus, setPipelineStatus] = useState<PipelineStatus>('idle')
  const [pipelineError, setPipelineError] = useState('')
  const [activeCollectionId, setActiveCollectionId] = useState<string | null>(null)

  const isProcessing = pipelineStatus === 'processing_text' || pipelineStatus === 'processing_graph'
  const isLocked = isUploading || isProcessing

  // Refs para limpieza
  const abortControllersRef = useRef<AbortController[]>([])
  const UPLOAD_IN_PROGRESS_KEY = 'upload_in_progress_collection_id'

  // --- Lógica de Cierre y Reset ---
  const handleClose = useCallback(() => {
    if (isLocked) return
    setFiles([])
    setNombreColeccion('')
    setError('')
    setEtapa('subida')
    setPipelineStatus('idle')
    setPipelineError('')
    setIsUploading(false)
    onClose()
    navigate('/landing_page')
  }, [onClose, navigate, isLocked])

  useEffect(() => {
    if (!isOpen) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isLocked) handleClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [isOpen, handleClose, isLocked])

  // --- Polling del Pipeline ---
  useEffect(() => {
    if (etapa !== 'pipeline' || !isProcessing || !activeCollectionId) return

    const interval = window.setInterval(async () => {
      try {
        const token = await getAccessTokenSilently()
        const res = await fetch(`${API_URL}/api/collections/${activeCollectionId}`, {
          headers: { Authorization: `Bearer ${token}` }
        })
        if (!res.ok) return
        const data = await res.json()
        const status: PipelineStatus = data.processing_status ?? 'idle'
        setPipelineStatus(status)
        if (status === 'graph_ready' || status === 'error') {
          if (status === 'error') setPipelineError(data.processing_error_message ?? 'Error desconocido')
        }
      } catch (e) {
        console.error('Error en polling:', e)
      }
    }, 3000)

    return () => clearInterval(interval)
  }, [etapa, isProcessing, activeCollectionId, getAccessTokenSilently, API_URL])

  // --- Funciones de Carga (Tus funciones originales) ---
  const createCollection = async () => {
    const token = await getAccessTokenSilently()
    const response = await fetch(`${API_URL}/api/collections`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name: nombreColeccion || 'Nueva colección', description: '' }),
    })
    if (!response.ok) throw new Error('Error al crear colección')
    return await response.json()
  }

  const uploadOneFile = async (file: File, collectionId: string, signal?: AbortSignal) => {
    const token = await getAccessTokenSilently()
    const formData = new FormData()
    formData.append('file', file)
    const response = await fetch(`${API_URL}/api/documentos/upload?coleccion_id=${collectionId}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
      signal,
    })
    if (!response.ok) throw new Error(`Error al subir ${file.name}`)
    return await response.json()
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
        try {
          await uploadOneFile(file, collection.id)
          uploaded++
          setUploadedCount(uploaded)
        } catch (e) {
          setFailedCount(prev => prev + 1)
        }
      }

      sessionStorage.removeItem(UPLOAD_IN_PROGRESS_KEY)
      if (onUploadSuccess) onUploadSuccess()
      setEtapa('pipeline') // CAMBIO A ETAPA PIPELINE
    } catch (err: any) {
      setError(err.message || 'Error en el proceso de carga')
    } finally {
      setIsUploading(false)
    }
  }

  const handleIniciarPipeline = async () => {
    if (!activeCollectionId) return
    setPipelineError('')
    try {
      const token = await getAccessTokenSilently()
      const res = await fetch(`${API_URL}/api/collections/${activeCollectionId}/process`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error('Error al iniciar el pipeline')
      setPipelineStatus('processing_text')
    } catch (e: any) {
      setPipelineError(e.message || 'No se pudo iniciar el pipeline')
    }
  }

  const finalizarTodo = () => {
    if (!activeCollectionId) return
    handleClose()
    // Navegación final a tu buscador como el modal viejo
    navigate(`/user/colecciones/${activeCollectionId}/buscador`)
  }

  if (!isOpen) return null

  return (
    <div className="mc-overlay" onClick={isLocked ? undefined : handleClose}>
      <div className={`mc-panel${darkMode ? ' dark' : ''}`} onClick={(e) => e.stopPropagation()}>
        
        {/* HEADER */}
        <div className="mc-header">
          <div>
            <h2 className="mc-title">
              {etapa === 'subida' ? 'Añadir fuentes' : 'Procesar colección'}
            </h2>
            <p className="mc-subtitle">
              {etapa === 'subida' 
                ? 'Sube documentos para indexar en tu colección' 
                : 'Genera el grafo de conocimiento a partir de tus documentos'}
            </p>
          </div>
          <button className="mc-close" onClick={handleClose} disabled={isLocked}>
            <X size={18} />
          </button>
        </div>

        {etapa === 'subida' ? (
          <>
            {/* VISTA DE SUBIDA ORIGINAL */}
            <div
              className={`mc-dropzone${isDragging ? ' dragging' : ''} ${isLocked ? ' disabled' : ''}`}
              onDragOver={(e) => { e.preventDefault(); if (!isLocked) setIsDragging(true) }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={(e) => { e.preventDefault(); setIsDragging(false); if (!isLocked) setFiles(Array.from(e.dataTransfer.files)) }}
              onClick={() => { if (!isLocked) fileInputRef.current?.click() }}
            >
              <input type="file" multiple hidden ref={fileInputRef} accept=".pdf,.txt" onChange={(e) => setFiles(Array.from(e.target.files || []))} disabled={isLocked} />
              <div className="mc-drop-icon"><CloudUpload size={26} /></div>
              <p className="mc-drop-title">{isDragging ? 'Suelta los archivos aquí' : 'Arrastra tus archivos aquí'}</p>
              <p className="mc-drop-sub">PDF o TXT · Máx. 50 MB por archivo</p>
            </div>

            {files.length > 0 && (
              <div className="mc-file-list">
                {files.map((f, i) => (
                  <div key={i} className="mc-file-item">
                    <FileText size={14} className="mc-file-icon" />
                    <span className="mc-file-name">{f.name}</span>
                    <span className="mc-file-size">{formatSize(f.size)}</span>
                    <button className="mc-file-remove" disabled={isLocked} onClick={() => setFiles(prev => prev.filter((_, idx) => idx !== i))}>
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {error && <p className="mc-error-message">{error}</p>}
            {isUploading && <p className="mc-success-message">Subiendo {uploadedCount} de {files.length} archivos...</p>}

            <div className="mc-collection-name">
              <input type="text" className="mc-input" placeholder="Nombre de colección" value={nombreColeccion} onChange={(e) => setNombreColeccion(e.target.value)} disabled={isLocked} />
            </div>

            <div className="mc-footer">
              <button className="mc-btn-cancel" onClick={handleClose} disabled={isLocked}>Cancelar</button>
              <button className="mc-btn-upload" disabled={files.length === 0 || isLocked || !nombreColeccion.trim()} onClick={handleUpload}>
                {isUploading ? 'Subiendo...' : 'Añadir a la colección'}
              </button>
            </div>
          </>
        ) : (
          /* VISTA DE PIPELINE INTEGRADA */
          <div className="mc-pipeline">
            <div className="mc-steps">
              {[
                { key: 'processing_text', label: 'Extracción de texto' },
                { key: 'processing_graph', label: 'Construcción del grafo' },
                { key: 'graph_ready', label: 'Grafo disponible' },
              ].map(step => {
                const isDone = (step.key === 'processing_text' && (pipelineStatus === 'processing_graph' || pipelineStatus === 'graph_ready')) ||
                               (step.key === 'processing_graph' && pipelineStatus === 'graph_ready') ||
                               step.key === pipelineStatus;
                const isActive = step.key === pipelineStatus && pipelineStatus !== 'graph_ready';

                return (
                  <div key={step.key} className={`mc-step ${isActive ? 'active' : ''} ${isDone ? 'done' : ''}`}>
                    <div className="mc-step-icon">
                      {isActive ? <Loader2 size={16} className="mc-spin" /> : isDone ? <CheckCircle2 size={16} /> : <div className="mc-step-dot" />}
                    </div>
                    <span className="mc-step-label">{step.label}</span>
                  </div>
                )
              })}
            </div>

            <p className="mc-pipeline-status">{PIPELINE_LABELS[pipelineStatus]}</p>
            {pipelineError && <div className="mc-pipeline-error"><AlertCircle size={14} /> <span>{pipelineError}</span></div>}

            <div className="mc-footer">
              {pipelineStatus === 'idle' && (
                <>
                  <button className="mc-btn-cancel" onClick={handleClose}>Luego</button>
                  <button className="mc-btn-upload" onClick={handleIniciarPipeline}><Network size={14} /> Generar grafo</button>
                </>
              )}
              {isProcessing && <p className="mc-processing-note">Esto puede tardar varios minutos. No cierres esta ventana.</p>}
              {pipelineStatus === 'graph_ready' && (
                <button className="mc-btn-upload" onClick={finalizarTodo}><CheckCircle2 size={14} /> Finalizar</button>
              )}
              {pipelineStatus === 'error' && (
                <>
                  <button className="mc-btn-cancel" onClick={handleClose}>Cerrar</button>
                  <button className="mc-btn-upload" onClick={handleIniciarPipeline}>Reintentar</button>
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