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
  const [mensaje, setMensaje] = useState('')
  const [error, setError] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [nombreColeccion, setNombreColeccion] = useState('')
  const navigate = useNavigate()


  const handleClose = useCallback(() => {
    if (isUploading) return // No dejar cerrar si está subiendo
    setFiles([])
    setMensaje('')
    setError('')
    setIsUploading(false)
    onClose()
  }, [onClose, isUploading])

  useEffect(() => {
    if (!isOpen) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isUploading) handleClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [isOpen, handleClose, isUploading])

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
    if (isUploading) return
    setFiles((prev) => prev.filter((_, idx) => idx !== i))
  }

  const createCollection = async (): Promise<CollectionResponse> => {
    const token = await getAccessTokenSilently()

    const response = await fetch('http://localhost:8000/api/collections', {
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
    ///VER RUTA BACKEND
    const response = await fetch(
      `http://localhost:8000/api/documentos/upload?coleccion_id=${collectionId}`,
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

  const handleUpload = async () => {
    if (files.length === 0) return

    setIsUploading(true)
    setMensaje('')
    setError('')

    try {
      const collection = await createCollection()
      await Promise.all(files.map((file) => uploadOneFile(file, collection.id)))

      setMensaje('Colección creada y archivos subidos correctamente.')
      setFiles([])

      setTimeout(() => {
        handleClose()
        const userId = collection.user_id.split('|')[1] || collection.user_id
        navigate(`/${userId}/colecciones/${collection.id}/buscador`)
      }, 1200)
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : 'Error inesperado al crear la colección o subir archivos'
      setError(message)
    } finally {
      setIsUploading(false)
    }
  }

  return (
    <div className="mc-overlay" onClick={isUploading ? undefined : handleClose}>
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
            disabled={isUploading}
          >
            <X size={18} />
          </button>
        </div>

        <div
          className={`mc-dropzone${isDragging ? ' dragging' : ''} ${isUploading ? ' disabled' : ''}`}
          onDragOver={(e) => {
            e.preventDefault()
            if (!isUploading) setIsDragging(true)
          }}
          onDragEnter={(e) => {
            e.preventDefault()
            if (!isUploading) setIsDragging(true)
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={(e) => {
            e.preventDefault()
            setIsDragging(false)
            if (!isUploading) addFiles(e.dataTransfer.files)
          }}
          onClick={() => {
            if (!isUploading) fileInputRef.current?.click()
          }}
        >
          <input
            type="file"
            multiple
            hidden
            ref={fileInputRef}
            accept=".pdf,.txt"
            onChange={(e) => addFiles(e.target.files)}
            disabled={isUploading}
          />
          <div className="mc-drop-icon">
            <CloudUpload size={26} />
          </div>
          <p className="mc-drop-title">
            {isDragging
              ? 'Suelta los archivos aquí'
              : 'Arrastra tus archivos aquí'}
          </p>
          <p className="mc-drop-sub">PDF, o TXT · Máx. 25 MB por archivo</p>
          <button
            className="mc-drop-btn"
            disabled={isUploading}
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
                  disabled={isUploading}
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
        <div className="mc-collection-name">
          <input
            type="text"
            className="mc-input"
            placeholder="Nombre de colección"
            value={nombreColeccion}
            onChange={(e) => setNombreColeccion(e.target.value)}
            disabled={isUploading}
          />
        </div>
        <div className="mc-footer">
          <button
            className="mc-btn-cancel"
            onClick={handleClose}
            disabled={isUploading}
          >
            Cancelar
          </button>
          <button
            className="mc-btn-upload"
            disabled={
              files.length === 0 || isUploading || !nombreColeccion.trim()
            }
            onClick={handleUpload}
          >
            {isUploading
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
