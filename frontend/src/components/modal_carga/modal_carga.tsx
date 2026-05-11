import { useState, useRef, useEffect, useCallback } from 'react'
import { useAuth0 } from '@auth0/auth0-react'
import { X, CloudUpload, FileText, Trash2 } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import './modal_carga.css'

interface ModalCargaProps {
  isOpen: boolean
  onClose: () => void
  darkMode?: boolean
  coleccionId: string // NUEVO: Necesitamos saber a qué colección va el archivo
  onUploadSuccess?: () => void // NUEVO: Para avisarle a la página que recargue la lista
}

interface DocumentResponse {
  id: string
  user_id: string
  collection_id: string
  filename: string
  file_type: string
  file_size_bytes: number | null
  storage_path: string
  status: string
  error_message: string | null
  created_at: string
}

interface CollectionResponse {
  id: string
  user_id: string
  name: string
  description: string | null
  status: string
  created_at: string
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const ModalCarga = ({ isOpen, onClose, darkMode = false }: ModalCargaProps) => {
  const { getAccessTokenSilently } = useAuth0()
  const [files, setFiles] = useState<File[]>([])
  const [isDragging, setIsDragging] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [isFinalizing, setIsFinalizing] = useState(false)
  const isLocked = isUploading || isFinalizing
  const [uploadedCount, setUploadedCount] = useState(0)
  const [failedCount, setFailedCount] = useState(0)
  const [mensaje, setMensaje] = useState('')
  const [error, setError] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [nombreColeccion, setNombreColeccion] = useState('')
  const navigate = useNavigate()

  const handleClose = useCallback(() => {
    if (isLocked) return // No dejar cerrar si está subiendo
    setFiles([])
    setMensaje('')
    setError('')
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

  if (!isOpen) return null

  const addFiles = (list: FileList | null) => {
    if (!list) return
    const incoming = Array.from(list)
    setFiles((prev) => {
      const existing = new Set(prev.map((f) => f.name + f.size))
      return [
        ...prev,
        ...incoming.filter((f) => !existing.has(f.name + f.size)),
      ]
    })
  }

  const removeFile = (i: number) => {
    if (isLocked) return
    setFiles((prev) => prev.filter((_, idx) => idx !== i))
  }

  const createCollection = async (): Promise<CollectionResponse> => {
    const token = await getAccessTokenSilently()
    ////CAMBIAR POR LINK DEPLOY
    const response = await fetch('http://localhost:8080/api/collections', {
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

    const text = await response.text()
    const data = text ? JSON.parse(text) : null

    if (!response.ok) {
      throw new Error(data?.detail || 'Error al crear colección')
    }

    return data
  }

  const uploadOneFile = async (
    file: File,
    collectionId: string,
  ): Promise<DocumentResponse> => {
    const token = await getAccessTokenSilently()

    const formData = new FormData()
    formData.append('file', file)
    ////CAMBIAR POR LINK DEPLOY
    const response = await fetch(
      `http://localhost:8080/api/documentos/upload?coleccion_id=${collectionId}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: formData,
      },
    )
    const text = await response.text()
    const data = text ? JSON.parse(text) : null

    if (!response.ok) {
      throw new Error(data?.detail || 'Error al subir archivo')
    }

    return data
  }

  const uploadWithQueue = async (
    files: File[],
    collectionId: string,
    concurrency = 5,
    maxRetries = 3,
  ) => {
    let uploaded = 0
    let failed = 0

    const uploadWithRetry = async (file: File) => {
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          await uploadOneFile(file, collectionId)

          uploaded += 1
          setUploadedCount(uploaded)

          return
        } catch (err) {
          if (attempt === maxRetries) {
            failed += 1
            setFailedCount(failed)
            console.error(`Falló la subida de ${file.name}`, err)
            return
          }

          await new Promise((resolve) => setTimeout(resolve, attempt * 1000))
        }
      }
    }

    for (let i = 0; i < files.length; i += concurrency) {
      const batch = files.slice(i, i + concurrency)
      await Promise.all(batch.map(uploadWithRetry))
    }

    return { uploaded, failed }
  }

  const handleUpload = async () => {
    if (files.length === 0) return

    setIsUploading(true)
    setMensaje('')
    setError('')
    setUploadedCount(0)
    setFailedCount(0)

    try {
      const collection = await createCollection()
      const result = await uploadWithQueue(files, collection.id, 5, 3)

      setMensaje(
        `Archivos exitosos: ${result.uploaded} · Archivos fallidos: ${result.failed}`,
      )
      setFiles([])
      setIsFinalizing(true)
      setTimeout(() => {
        handleClose()
        const userId = collection.user_id.split('|')[1] || collection.user_id
        navigate(`/${userId}/colecciones/${collection.id}/buscador`)
      }, 5000)
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : 'Error inesperado al crear la colección o subir archivos'
      setError(message)
    } finally {
      if (!isFinalizing) {
        setIsUploading(false)
      }
    }
  }

  return (
    <div className="mc-overlay" onClick={isLocked ? undefined : handleClose}>
      <div
        className={`mc-panel${darkMode ? ' dark' : ''}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mc-header">
          <div>
            <h2 className="mc-title">Añadir fuentes</h2>
            <p className="mc-subtitle">
              Sube documentos para indexar en tu colección
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

        <div
          className={`mc-dropzone${isDragging ? ' dragging' : ''} ${isLocked ? ' disabled' : ''}`}
          onDragOver={(e) => {
            e.preventDefault()
            if (!isLocked) setIsDragging(true)
          }}
          onDragEnter={(e) => {
            e.preventDefault()
            if (!isLocked) setIsDragging(true)
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={(e) => {
            e.preventDefault()
            setIsDragging(false)
            if (!isLocked) addFiles(e.dataTransfer.files)
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
            onChange={(e) => addFiles(e.target.files)}
            disabled={isLocked}
          />
          <div className="mc-drop-icon">
            <CloudUpload size={26} />
          </div>
          <p className="mc-drop-title">
            {isDragging
              ? 'Suelta los archivos aquí'
              : 'Arrastra tus archivos aquí'}
          </p>
          <p className="mc-drop-sub">PDF, o TXT · Máx. 50 MB por archivo</p>
          <button
            className="mc-drop-btn"
            disabled={isLocked}
            onClick={(e) => {
              e.stopPropagation()
              fileInputRef.current?.click()
            }}
          >
            Seleccionar archivos
          </button>
        </div>

        {files.length > 0 && (
          <div className="mc-file-list">
            {files.map((f, i) => (
              <div key={`${f.name}-${f.size}`} className="mc-file-item">
                <FileText size={14} className="mc-file-icon" />
                <span className="mc-file-name">{f.name}</span>
                <span className="mc-file-size">{formatSize(f.size)}</span>
                <button
                  className="mc-file-remove"
                  disabled={isLocked}
                  onClick={() => removeFile(i)}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
        )}

        {mensaje && <p className="mc-success-message">{mensaje}</p>}
        {error && <p className="mc-error-message">{error}</p>}
        {isLocked && (
          <p className="mc-success-message">
            Subiendo {uploadedCount + failedCount} de {files.length} archivos...
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
            {isLocked
              ? 'Subiendo...'
              : files.length > 0
                ? `Añadir ${files.length} archivo${files.length > 1 ? 's' : ''}`
                : 'Añadir a la colección'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default ModalCarga
