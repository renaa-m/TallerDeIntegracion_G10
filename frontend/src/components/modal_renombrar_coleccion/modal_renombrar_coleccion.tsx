import { useEffect, useState } from 'react'
import './modal_renombrar_coleccion.css'

interface ModalRenombrarColeccionProps {
  isOpen: boolean
  nombreActual: string
  isSaving?: boolean
  onConfirm: (nuevoNombre: string) => void
  onClose: () => void
}

function ModalRenombrarColeccion({
  isOpen,
  nombreActual,
  isSaving = false,
  onConfirm,
  onClose,
}: ModalRenombrarColeccionProps) {
  const [nombre, setNombre] = useState(nombreActual)

  useEffect(() => {
    if (isOpen) {
      setNombre(nombreActual)
    }
  }, [isOpen, nombreActual])

  if (!isOpen) return null

  const trimmed = nombre.trim()
  const canSave = trimmed.length > 0 && trimmed !== nombreActual.trim()

  return (
    <div
      className="mrc-overlay"
      onClick={isSaving ? undefined : onClose}
      role="presentation"
    >
      <div
        className="mrc-box"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="mrc-title"
      >
        <h3 id="mrc-title" className="mrc-title">
          Renombrar Colección
        </h3>

        <p className="mrc-text">
          Elige un nombre claro para identificar esta colección en tu espacio de
          trabajo.
        </p>

        <label className="mrc-label" htmlFor="mrc-input">
          Nombre
        </label>
        <input
          id="mrc-input"
          className="mrc-input"
          type="text"
          value={nombre}
          disabled={isSaving}
          onChange={(e) => setNombre(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && canSave && !isSaving) {
              onConfirm(trimmed)
            }
          }}
        />

        <div className="mrc-actions">
          <button
            type="button"
            className="mrc-btn mrc-btn-cancel"
            onClick={onClose}
            disabled={isSaving}
          >
            Cancelar
          </button>
          <button
            type="button"
            className="mrc-btn mrc-btn-confirm"
            onClick={() => onConfirm(trimmed)}
            disabled={!canSave || isSaving}
          >
            {isSaving ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default ModalRenombrarColeccion
