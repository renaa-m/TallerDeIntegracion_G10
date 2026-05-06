import React from 'react'
import { X, FileText, Loader2 } from 'lucide-react'
import './modal_documentos_disponibles.css'

interface Fuente {
  id: string
  filename: string
  file_type: string
  status: string
}

interface ModalProps {
  isOpen: boolean
  fuentes: Fuente[]
  onClose: () => void
  darkMode?: boolean
}

const ModalDocumentosDisponibles: React.FC<ModalProps> = ({ isOpen, fuentes, onClose, darkMode }) => {
  if (!isOpen) return null

  return (
    // Se aplica 'bc-dark' solo si darkMode ezs true para activar el CSS que adjuntaste
    <div className={`mdd-overlay ${darkMode ? 'bc-dark' : ''}`} onClick={onClose}>
      <div className="mdd-panel" onClick={(e) => e.stopPropagation()}>
        <header className="mdd-header">
          <div className="mdd-header-left">
            <h2 className="mdd-title">Documentos Disponibles</h2>
            <span className="mdd-subtitle">{fuentes.length} archivos en esta colección</span>
          </div>
          <button className="mdd-close" onClick={onClose}><X size={18} /></button>
        </header>

        <div className="mdd-body">
          <div className="mdd-list">
            {fuentes.length === 0 ? (
              <div className="mdd-empty">No hay documentos cargados.</div>
            ) : (
              fuentes.map((f) => (
                <div key={f.id} className="mdd-card">
                  <div className="mdd-card-icon">
                    {f.status === 'processing' ? (
                      <Loader2 className="mdd-spin" size={20} />
                    ) : (
                      <FileText size={20} />
                    )}
                  </div>
                  <div className="mdd-card-content">
                    <span className="mdd-card-title">{f.filename}</span>
                    <div className="mdd-card-footer">
                      <span className="mdd-tag">{f.file_type}</span>
                      {/* Usamos las clases status que ya tienes en el CSS */}
                      <span className={`mdd-error-tag ${f.status}`}>
                        {f.status === 'ok' ? 'Listo' : f.status}
                      </span>
                    </div>
                  </div>
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