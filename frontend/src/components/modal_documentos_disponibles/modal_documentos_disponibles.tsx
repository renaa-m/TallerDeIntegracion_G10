import React, { useState } from 'react'
import { X, FileText, Loader2, ExternalLink } from 'lucide-react'
import { useAuth0 } from '@auth0/auth0-react'
import './modal_documentos_disponibles.css'

const API_URL = import.meta.env.VITE_API_URL || ''

interface Fuente {
  id: string
  filename: string
  file_type: string
  storage_path: string
  status: string
  url?: string
}

interface ModalProps {
  isOpen: boolean
  fuentes: Fuente[]
  onClose: () => void
}

interface LoadingStates {
  [key: string]: boolean
}

const ModalDocumentosDisponibles: React.FC<ModalProps> = ({
  isOpen,
  fuentes,
  onClose,
}) => {
  const { getAccessTokenSilently } = useAuth0()
  const [loadingStates, setLoadingStates] = useState<LoadingStates>({})

  if (!isOpen) return null

  // Función para obtener URL temporal firmada
  const getSignedUrl = async (storagePath: string): Promise<string> => {
    try {
      const token = await getAccessTokenSilently()

      const res = await fetch(
        `${API_URL}/api/documentos/signed-url?path=${encodeURIComponent(storagePath)}`,
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      )

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}))
        throw new Error(
          errorData.detail || `Error ${res.status}: No se pudo generar la URL`
        )
      }

      const data = await res.json()
      
      if (!data.url) {
        throw new Error('La respuesta del servidor no contiene una URL válida')
      }

      return data.url
    } catch (error) {
      console.error('Error obteniendo URL firmada:', error)
      throw error
    }
  }

  // Función mejorada para acceder al documento
  const handleAccessDocument = async (
    e: React.MouseEvent,
    docId: string,
    storagePath: string
  ) => {
    e.stopPropagation()

    setLoadingStates(prev => ({ ...prev, [docId]: true }))

    try {
      // Obtener URL temporal firmada (expira en 5 minutos)
      const signedUrl = await getSignedUrl(storagePath)

      // Abrir documento en nueva pestaña
      window.open(signedUrl, '_blank')
    } catch (error) {
      console.error('Error al acceder al documento:', error)
      alert(`No se pudo abrir el documento.\n\n${error instanceof Error ? error.message : 'Intenta de nuevo.'}`)
    } finally {
      setLoadingStates(prev => ({ ...prev, [docId]: false }))
    }
  }

  return (
    <div className="mdd-overlay" onClick={onClose}>
      <div className="mdd-panel" onClick={(e) => e.stopPropagation()}>
        <header className="mdd-header">
          <div className="mdd-header-left">
            <h2 className="mdd-title">Documentos Disponibles</h2>
            <span className="mdd-subtitle">
              {fuentes.length} archivos en esta colección
            </span>
          </div>
          <button className="mdd-close" onClick={onClose}>
            <X size={18} />
          </button>
        </header>

        <div className="mdd-body">
          <div className="mdd-list">
            {fuentes.length === 0 ? (
              <div className="mdd-empty">No hay documentos cargados.</div>
            ) : (
              fuentes.map((f) => (
                <div
                  key={f.id}
                  className="mdd-card"
                  onClick={() => console.log('Seleccionado:', f.id)}
                >
                  <div className="mdd-card-icon">
                    {f.status === 'processing' ? (
                      <Loader2 className="mdd-spin" size={20} />
                    ) : loadingStates[f.id] ? (
                      <Loader2 className="mdd-spin" size={20} />
                    ) : (
                      <FileText size={20} />
                    )}
                  </div>

                  <div className="mdd-card-content">
                    <span className="mdd-card-title">{f.filename}</span>
                  </div>

                  {/* BOTÓN DE ACCESO CON URL TEMPORAL FIRMADA */}
                  <button
                    type="button"
                    className="mdd-access-btn"
                    onClick={(e) =>
                      handleAccessDocument(e, f.id, f.storage_path)
                    }
                    disabled={
                      f.status === 'processing' || loadingStates[f.id] === true
                    }
                    title={
                      f.status === 'processing'
                        ? 'Documento en procesamiento'
                        : loadingStates[f.id]
                          ? 'Generando enlace...'
                          : 'Acceder al documento (enlace válido 5 minutos)'
                    }
                    aria-label={
                      f.status === 'processing'
                        ? 'Documento en procesamiento'
                        : 'Acceder al documento'
                    }
                  >
                    <ExternalLink size={16} />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default ModalDocumentosDisponibles