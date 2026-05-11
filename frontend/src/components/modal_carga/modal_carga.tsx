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
    localStorage.getItem(ACTIVE_COLLECTION_KEY)
  )

  const isLocked =
    isUploading ||
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
            setPipelineStatus(data.processing_status ?? 'idle')
          }
        } catch (e) {
          console.error('Error al recuperar estado tras recarga:', e)
        }
      }
    }
    syncStatus()
  }, [isOpen, getAccessTokenSilently])

  // --- 2. Lógica de Cierre y Cancelación Real ---
  const handleClose = useCallback(async () => {
    if (isLocked) return

    // Si hay una colección creada pero no finalizada, la borramos en el Back
    if (activeCollectionId && pipelineStatus !== 'graph_ready') {
      try {
        const token = await getAccessTokenSilently()
        await fetch(`${API_BASE}/api/collections/${activeCollectionId}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        })
      } catch (err) {
        console.error('Error borrando colección cancelada:', err)
      }
    }

    // Limpieza total
    localStorage.removeItem(ACTIVE_COLLECTION_KEY)
    localStorage.removeItem(MODAL_ETAPA_KEY)
    setFiles([])
    setNombreColeccion('')
    setError('')
    setEtapa('subida')
    setPipelineStatus('idle')
    setActiveCollectionId(null)
    
    navigate('/landing_page')
    onClose()
  }, [onClose, isLocked, activeCollectionId, pipelineStatus, getAccessTokenSilently, navigate])

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

  const handleUpload = async () => {
    if (files.length === 0) return
    setIsUploading(true)
    setError('')

    try {
      // Crear colección e iniciar persistencia
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
        } else {
          setFailedCount((prev) => prev + 1)
        }
      }

      if (uploaded === 0) throw new Error('No se subieron archivos.')

      setEtapa('pipeline')
      localStorage.setItem(MODAL_ETAPA_KEY, 'pipeline')
      if (onUploadSuccess) onUploadSuccess()
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

  // Finalización exitosa: Limpiamos storage y navegamos al buscador
  const handleFinalizarExito = () => {
    localStorage.removeItem(ACTIVE_COLLECTION_KEY)
    localStorage.removeItem(MODAL_ETAPA_KEY)
    onClose()
    navigate(`/user/colecciones/${activeCollectionId}/buscador`)
  }

  if (!isOpen) return null

  return (
    <div className="mc-overlay" onClick={isLocked ? undefined : handleClose}>
      <div className={`mc-panel${darkMode ? ' dark' : ''}`} onClick={(e) => e.stopPropagation()}>
        <div className="mc-header">
          <div>
            <h2 className="mc-title">{etapa === 'subida' ? 'Añadir fuentes' : 'Procesar grafo'}</h2>
            <p className="mc-subtitle">
              {etapa === 'subida' ? 'Sube documentos para indexar' : 'Construye el grafo de conocimiento'}
            </p>
          </div>
          <button className="mc-close" onClick={handleClose} disabled={isLocked}>
            <X size={18} />
          </button>
        </div>

        {etapa === 'subida' ? (
          <>
            <div
              className={`mc-dropzone ${isDragging ? 'dragging' : ''} ${isLocked ? 'disabled' : ''}`}
              onDragOver={(e) => { e.preventDefault(); if (!isLocked) setIsDragging(true) }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={(e) => {
                e.preventDefault()
                setIsDragging(false)
                if (!isLocked) setFiles(Array.from(e.dataTransfer.files))
              }}
              onClick={() => { if (!isLocked) fileInputRef.current?.click() }}
            >
              <input type="file" multiple hidden ref={fileInputRef} accept=".pdf,.txt"
                onChange={(e) => setFiles(Array.from(e.target.files || []))} disabled={isLocked} />
              <div className="mc-drop-icon"><CloudUpload size={26} /></div>
              <p className="mc-drop-title">{isDragging ? 'Suelta los archivos' : 'Arrastra tus archivos aquí'}</p>
              <p className="mc-drop-sub">PDF o TXT · Máx. 50 MB</p>
            </div>

            {files.length > 0 && (
              <div className="mc-file-list">
                {files.map((f, i) => (
                  <div key={`${f.name}-${i}`} className="mc-file-item">
                    <FileText size={14} className="mc-file-icon" />
                    <span className="mc-file-name">{f.name}</span>
                    <button className="mc-file-remove" disabled={isLocked}
                      onClick={() => setFiles((prev) => prev.filter((_, idx) => idx !== i))}>
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {error && <p className="mc-error-message"><AlertCircle size={14} /> {error}</p>}
            {isUploading && <p className="mc-success-message">Subiendo {uploadedCount} de {files.length}...</p>}

            <div className="mc-collection-name">
              <input type="text" className="mc-input" placeholder="Nombre de colección"
                value={nombreColeccion} onChange={(e) => setNombreColeccion(e.target.value)} disabled={isLocked} />
            </div>

            <div className="mc-footer">
              <button className="mc-btn-cancel" onClick={handleClose} disabled={isLocked}>Cancelar</button>
              <button className="mc-btn-upload" onClick={handleUpload}
                disabled={files.length === 0 || isLocked || !nombreColeccion.trim()}>
                {isUploading ? 'Subiendo...' : 'Añadir archivos'}
              </button>
            </div>
          </>
        ) : (
          <div className="mc-pipeline">
            <div className="mc-steps">
              {['processing_text', 'processing_graph', 'graph_ready'].map((s, idx) => {
                const stepLabel = ['Extracción', 'Construcción', 'Listo'][idx]
                const isDone = (s === 'processing_text' && (pipelineStatus === 'processing_graph' || pipelineStatus === 'graph_ready')) ||
                               (s === 'processing_graph' && pipelineStatus === 'graph_ready') || s === pipelineStatus
                const isActive = s === pipelineStatus && pipelineStatus !== 'graph_ready'
                return (
                  <div key={s} className={`mc-step ${isActive ? 'active' : ''} ${isDone ? 'done' : ''}`}>
                    <div className="mc-step-icon">
                      {isActive ? <Loader2 size={16} className="mc-spin" /> : isDone ? <CheckCircle2 size={16} /> : <div className="mc-step-dot" />}
                    </div>
                    <span className="mc-step-label">{stepLabel}</span>
                  </div>
                )
              })}
            </div>
            <p className="mc-pipeline-status">{PIPELINE_LABELS[pipelineStatus]}</p>
            {pipelineError && <div className="mc-pipeline-error"><AlertCircle size={14} /> {pipelineError}</div>}
            <div className="mc-footer">
              {pipelineStatus === 'idle' && (
                <button className="mc-btn-upload" onClick={handleIniciarPipeline}>
                  <Network size={14} /> Generar grafo
                </button>
              )}
              {pipelineStatus === 'graph_ready' && (
                <button className="mc-btn-upload" onClick={handleFinalizarExito}>
                  <CheckCircle2 size={14} /> Finalizar
                </button>
              )}
              {pipelineStatus === 'error' && (
                <button className="mc-btn-upload" onClick={handleIniciarPipeline}>Reintentar</button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default ModalCarga