import React from 'react'
import { X, FileText, Loader2, ExternalLink } from 'lucide-react'
import './modal_documentos_disponibles.css'

interface Fuente {
  id: string
  filename: string
  file_type: string
  status: string
  url?: string
}

interface ModalProps {
  isOpen: boolean
  fuentes: Fuente[]
  onClose: () => void
  darkMode?: boolean
}

const ModalDocumentosDisponibles: React.FC<ModalProps> = ({
  isOpen,
  fuentes,
  onClose,
  darkMode,
}) => {
  if (!isOpen) return null

  // Función simplificada usando el enlace directo
  const handleAccessDocument = (e: React.MouseEvent, url?: string) => {
    e.stopPropagation() // Evita que se dispare el onClick de la tarjeta

    if (url) {
      window.open(url, '_blank')
    } else {
      console.error('El documento no tiene un enlace disponible')
    }
  }

  return (
    <div
      className={`mdd-overlay ${darkMode ? 'bc-dark' : ''}`}
      onClick={onClose}
    >
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
                    ) : (
                      <FileText size={20} />
                    )}
                  </div>

                  <div className="mdd-card-content">
                    <span className="mdd-card-title">{f.filename}</span>
                  </div>

                  {/* BOTÓN DE ACCESO USANDO LA URL FIRMADA */}
                  <button
                    type="button"
                    className="mdd-access-btn"
                    onClick={(e) => handleAccessDocument(e, f.url)}
                    disabled={!f.url || f.status === 'processing'}
                    title={f.url ? 'Acceder al documento' : 'URL no disponible'}
                    aria-label={
                      f.url ? 'Acceder al documento' : 'URL no disponible'
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
