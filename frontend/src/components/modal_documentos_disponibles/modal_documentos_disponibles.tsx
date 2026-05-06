import React from 'react'
import { X, FileText, AlertCircle, Loader2 } from 'lucide-react'
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
    <div className={`mdd-overlay ${darkMode ? 'bc-dark' : ''}`} onClick={onClose}>
      <div className="mdd-panel" onClick={(e) => e.stopPropagation()}>
        <header className="mdd-header">
          <h2 className="mdd-title">Documentos Disponibles</h2>
          <button className="mdd-close" onClick={onClose}><X size={18} /></button>
        </header>

        <div className="mdd-body">
          <div className="mdd-list">
            {fuentes.map((f) => (
              <div key={f.id} className="mdd-card">
                <div className="mdd-card-icon">
                  {f.status === 'processing' ? <Loader2 className="mdd-spin" /> : <FileText />}
                </div>
                <div className="mdd-card-content">
                  <span className="mdd-card-title">{f.filename}</span>
                  <span className={`mdd-status-text ${f.status}`}>{f.status}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

export default ModalDocumentosDisponibles