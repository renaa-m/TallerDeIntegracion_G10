import React, { useState, useMemo, useEffect, useCallback } from 'react'
import { X, Search, FileText, AlertCircle, ChevronRight } from 'lucide-react'
import './modal_documentos_disponibles.css'

interface Fuente {
  id?: string | number
  titulo?: string
  name?: string
  nombre?: string
  tipo?: string
  extension?: string
  format?: string
  estado?: string
  status?: string
}

interface ModalProps {
  isOpen: boolean
  fuentes?: Fuente[]
  onClose: () => void
  onSelectFuente?: (fuente: Fuente) => void
  darkMode?: boolean
}

const ModalDocumentosDisponibles: React.FC<ModalProps> = ({
  isOpen,
  fuentes = [],
  onClose,
  onSelectFuente,
  darkMode = false,
}) => {
  const [busqueda, setBusqueda] = useState('')

  // Limpiar y cerrar
  const handleClose = useCallback(() => {
    setBusqueda('')
    onClose()
  }, [onClose])

  // Escape para cerrar
  useEffect(() => {
    if (!isOpen) return
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose()
    }
    window.addEventListener('keydown', handleEsc)
    return () => window.removeEventListener('keydown', handleEsc)
  }, [isOpen, handleClose])

  const fuentesFiltradas = useMemo(() => {
    const term = busqueda.toLowerCase().trim()
    return fuentes.filter(
      (f) =>
        (f.titulo || f.name || f.nombre || '').toLowerCase().includes(term) ||
        (f.tipo || f.extension || '').toLowerCase().includes(term),
    )
  }, [fuentes, busqueda])

  if (!isOpen) return null

  return (
    <div
      className={`mdd-overlay ${darkMode ? 'bc-dark' : ''}`}
      onClick={handleClose}
    >
      <div className="mdd-panel" onClick={(e) => e.stopPropagation()}>
        <header className="mdd-header">
          <div>
            <h2 className="mdd-title">Fuentes indexadas</h2>
            <p className="mdd-subtitle">
              Explora los {fuentes.length} archivos de esta colección
            </p>
          </div>
          <button className="mdd-close" onClick={handleClose}>
            <X size={18} />
          </button>
        </header>

        <div className="mdd-search-area">
          <div className="mdd-search-box">
            <Search size={16} className="mdd-search-icon" />
            <input
              className="mdd-input"
              placeholder="Buscar documento..."
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              autoFocus
            />
          </div>
        </div>

        <div className="mdd-body">
          <div className="mdd-list">
            {fuentesFiltradas.length > 0 ? (
              fuentesFiltradas.map((f, i) => (
                <button
                  key={f.id || i}
                  className={`mdd-card ${f.estado === 'error' ? 'has-error' : ''}`}
                  onClick={() => onSelectFuente?.(f)}
                >
                  <div className="mdd-card-icon">
                    {f.estado === 'error' ? (
                      <AlertCircle size={20} color="#ef4444" />
                    ) : (
                      <FileText size={20} />
                    )}
                  </div>
                  <div className="mdd-card-content">
                    <span className="mdd-card-title">
                      {f.titulo || f.name || f.nombre}
                    </span>
                    <div className="mdd-card-meta">
                      <span className="mdd-tag">
                        {f.tipo || f.extension || 'DOC'}
                      </span>
                      {f.estado === 'error' && (
                        <span className="mdd-error-tag">Error de carga</span>
                      )}
                    </div>
                  </div>
                  <ChevronRight size={14} className="mdd-card-arrow" />
                </button>
              ))
            ) : (
              <div className="mdd-empty">
                <Search size={32} />
                <p>No se encontraron resultados</p>
              </div>
            )}
          </div>
        </div>

        <footer className="mdd-footer">
          <button className="mdd-btn-primary" onClick={handleClose}>
            Entendido
          </button>
        </footer>
      </div>
    </div>
  )
}

export default ModalDocumentosDisponibles
