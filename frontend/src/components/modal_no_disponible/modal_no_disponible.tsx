import { useEffect } from 'react'
import { X, AlertCircle } from 'lucide-react'
import '../modal_carga/modal_carga.css'

interface ModalNoDisponibleProps {
  isOpen: boolean
  onClose: () => void
}

const ModalNoDisponible = ({ isOpen, onClose }: ModalNoDisponibleProps) => {
  useEffect(() => {
    if (!isOpen) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [isOpen, onClose])

  if (!isOpen) return null

  return (
    <div className="mc-overlay" onClick={onClose}>
      <div className="mc-panel" onClick={(e) => e.stopPropagation()}>
        <div className="mc-header">
          <div>
            <h2 className="mc-title">Funcionalidad no disponible</h2>
            <p className="mc-subtitle">
              La vista de grafo aún no está disponible.
            </p>
          </div>
          <button className="mc-close" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div className="mc-dropzone" style={{ cursor: 'default' }}>
          <div
            className="mc-drop-icon"
            style={{ background: '#FDEDED', color: '#D93025' }}
          >
            <AlertCircle size={24} />
          </div>
          <p className="mc-drop-title">Próximamente</p>
          <p className="mc-drop-sub">
            Esta función aún no está disponible. Estamos trabajando en ella.
          </p>
        </div>

        <div className="mc-footer" style={{ justifyContent: 'center' }}>
          <button className="mc-btn-cancel" onClick={onClose}>
            Cerrar
          </button>
        </div>
      </div>
    </div>
  )
}

export default ModalNoDisponible
