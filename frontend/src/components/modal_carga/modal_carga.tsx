import { useState, useRef, useEffect, useCallback } from 'react'
import { X, CloudUpload, FileText, Trash2, Loader2 } from 'lucide-react'
// Asumimos que usan @auth0/auth0-react para la autenticación. 
// Si usan otro hook, avísame para ajustarlo.
import { useAuth0 } from '@auth0/auth0-react' 
import './modal_carga.css'

interface ModalCargaProps {
  isOpen: boolean
  onClose: () => void
  darkMode?: boolean
  coleccionId: string // NUEVO: Necesitamos saber a qué colección va el archivo
  onUploadSuccess?: () => void // NUEVO: Para avisarle a la página que recargue la lista
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const ModalCarga = ({ isOpen, onClose, darkMode = false, coleccionId, onUploadSuccess }: ModalCargaProps) => {
  const [files, setFiles] = useState<File[]>([])
  const [isDragging, setIsDragging] = useState(false)
  const [isUploading, setIsUploading] = useState(false) // NUEVO: Estado para mostrar un loader
  const fileInputRef = useRef<HTMLInputElement>(null)
  
  const { getAccessTokenSilently } = useAuth0() // NUEVO: Hook para sacar el token de Auth0

  const handleClose = useCallback(() => {
    if (isUploading) return // No dejar cerrar si está subiendo
    setFiles([])
    onClose()
  }, [onClose, isUploading])

  useEffect(() => {
    if (!isOpen) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [isOpen, handleClose])

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

  const removeFile = (i: number) =>
    setFiles((prev) => prev.filter((_, idx) => idx !== i))

  // NUEVO: Función real para subir los archivos al backend
  const handleUpload = async () => {
    if (files.length === 0) return
    setIsUploading(true)

    try {
      // 1. Obtener el token de Auth0 de forma silenciosa
      const token = await getAccessTokenSilently()

      // 2. Como el backend recibe 1 archivo por endpoint, subimos todos en paralelo
      const uploadPromises = files.map(async (file) => {
        const formData = new FormData()
        formData.append('file', file)

        // Usamos la URL base de tu API (ajusta el import.meta.env si tienen otro nombre)
        const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:8000'
        
        const response = await fetch(`${apiUrl}/api/documentos/upload?coleccion_id=${coleccionId}`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}` // Inyectamos la seguridad aquí
          },
          body: formData,
        })

        if (!response.ok) {
          const errorData = await response.json()
          throw new Error(errorData.detail || `Error al subir ${file.name}`)
        }
      })

      // Esperamos a que todos suban
      await Promise.all(uploadPromises)
      
      // Si todo sale bien:
      setFiles([])
      onUploadSuccess?.() // Avisamos al componente padre (la página) para que actualice la tabla
      onClose()

    } catch (error) {
      console.error("Error en subida:", error)
      const errorMessage = error instanceof Error ? error.message : "Error desconocido"
      alert(`Hubo un error al subir los archivos: ${errorMessage}`)
    } finally {
      setIsUploading(false)
    }
  }

  return (
    <div className="mc-overlay" onClick={handleClose}>
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
          <button className="mc-close" onClick={handleClose} disabled={isUploading}>
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
          onClick={() => !isUploading && fileInputRef.current?.click()}
        >
          <input
            type="file"
            multiple
            hidden
            ref={fileInputRef}
            accept=".pdf,.txt" // CORRECCIÓN: Según HU-01 solo PDF y TXT
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
          <p className="mc-drop-sub">
            PDF o TXT · Máx. 50 MB por archivo {/* CORRECCIÓN: Texto ajustado a la HU */}
          </p>
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
              <div key={i} className="mc-file-item">
                <FileText size={14} className="mc-file-icon" />
                <span className="mc-file-name">{f.name}</span>
                <span className="mc-file-size">{formatSize(f.size)}</span>
                <button
                  className="mc-file-remove"
                  onClick={() => removeFile(i)}
                  disabled={isUploading}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="mc-footer">
          <button className="mc-btn-cancel" onClick={handleClose} disabled={isUploading}>
            Cancelar
          </button>
          <button
            className="mc-btn-upload"
            disabled={files.length === 0 || isUploading}
            onClick={handleUpload} // NUEVO: Llamamos a nuestra función real
          >
            {isUploading ? (
              <><Loader2 className="animate-spin" size={16} style={{marginRight: '8px', display: 'inline'}} /> Subiendo...</>
            ) : files.length > 0 ? (
              `Añadir ${files.length} archivo${files.length > 1 ? 's' : ''}`
            ) : (
              'Añadir a la colección'
            )}
          </button>
        </div>
      </div>
    </div>
  )
}

export default ModalCarga