import { createPortal } from 'react-dom'; // Importante
import { AlertTriangle } from 'lucide-react';
import './modal_eliminar_cuenta.css';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  isDeleting: boolean;
}

const ModalEliminarCuenta = ({ isOpen, onClose, onConfirm, isDeleting }: Props) => {
  console.log('Modal isOpen:', isOpen) // <-- agrega esto
  if (!isOpen) return null

  // Creamos el contenido del modal
  const modalContent = (
    <div className="mea-overlay" onClick={onClose}>
      <div className="mea-box" onClick={(e) => e.stopPropagation()}>
        <div className="mea-icon-wrap">
          <div className="mea-icon-ring"></div>
          <AlertTriangle className="mea-icon-svg" />
        </div>

        <h2 className="mea-title">¿Borrar tu cuenta?</h2>
        <p className="mea-text">Estás a punto de eliminar tu acceso y todos tus datos.</p>
        <p className="mea-warning">ESTA ACCIÓN ES PERMANENTE</p>

        <div className="mea-actions">
          <button className="mea-btn mea-btn-cancel" onClick={onClose} disabled={isDeleting}>
            Mantener cuenta
          </button>
          <button className="mea-btn mea-btn-confirm" onClick={onConfirm} disabled={isDeleting}>
            {isDeleting ? 'Eliminando...' : 'Eliminar cuenta'}
          </button>
        </div>
      </div>
    </div>
  );

  // Lo renderizamos en el body de la página directamente
  return createPortal(modalContent, document.body);
};

export default ModalEliminarCuenta;