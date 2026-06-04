import './modal_eliminar_coleccion.css'

interface ModalEliminarColeccionProps {
  isOpen: boolean
  nombreColeccion?: string
  isConfirming?: boolean
  onConfirm: () => void
  onClose: () => void
}

function ModalEliminarColeccion({
  isOpen,
  nombreColeccion,
  isConfirming = false,
  onConfirm,
  onClose,
}: ModalEliminarColeccionProps) {
  if (!isOpen) return null

  return (
    <div className="mea-overlay" onClick={isConfirming ? undefined : onClose}>
      <div className="mea-box" onClick={(e) => e.stopPropagation()}>
        <div className="mea-icon-wrap">
          <div className="mea-icon-ring" />
          <svg
            className="mea-icon-svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
            <path d="M10 11v6" />
            <path d="M14 11v6" />
            <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
          </svg>
        </div>

        <h3 className="mea-title">Eliminar archivo</h3>

        <p className="mea-text">
          ¿Estás seguro de que quieres eliminar{' '}
          {nombreColeccion ? (
            <>
              <span className="mea-filename">"{nombreColeccion}"</span>{' '}
              permanentemente?
            </>
          ) : (
            'esta colección permanentemente?'
          )}
        </p>

        <p className="mea-warning">Esta acción no se puede deshacer.</p>

        <div className="mea-actions">
          <button
            className="mea-btn mea-btn-cancel"
            onClick={onClose}
            disabled={isConfirming}
          >
            Cancelar
          </button>
          <button
            className="mea-btn mea-btn-confirm"
            onClick={onConfirm}
            disabled={isConfirming}
          >
            {isConfirming ? 'Eliminando…' : 'Sí, eliminar'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default ModalEliminarColeccion
