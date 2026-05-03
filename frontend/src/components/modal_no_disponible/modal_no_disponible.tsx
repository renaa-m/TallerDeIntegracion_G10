import { useEffect } from 'react'
import { AlertCircle } from 'lucide-react'
import './modal_no_disponible.css'

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
    <div className="mnd-overlay" onClick={onClose}>
      <div className="mnd-panel" onClick={(e) => e.stopPropagation()}>
        {/* Icon area - similar al dropzone original pero como error */}
        <div className="mnd-icon-area">
          <div className="mnd-icon-wrap">
            <AlertCircle size={28} />
          </div>
          <p className="mnd-icon-label">Próximamente</p>
          <p className="mnd-icon-sub">
            Esta función aún no está disponible.
            <br />
            Estamos trabajando en ella.
          </p>
        </div>

        {/* Footer */}
        <div className="mnd-footer">
          <button className="mnd-btn-close" onClick={onClose}>
            Cerrar
          </button>
        </div>
      </div>
    </div>
  )
}

export default ModalNoDisponible
