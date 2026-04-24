import { useState, useRef, useEffect, useCallback } from "react";
import { X, CloudUpload, FileText, Trash2 } from "lucide-react";
import "./modal_carga.css";

interface ModalCargaProps {
  isOpen: boolean;
  onClose: () => void;
  darkMode?: boolean;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const ModalCarga = ({ isOpen, onClose, darkMode = false }: ModalCargaProps) => {
  const [files, setFiles] = useState<File[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleClose = useCallback(() => {
    setFiles([]);
    onClose();
  }, [onClose]);

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") handleClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isOpen, handleClose]);

  if (!isOpen) return null;

  const addFiles = (list: FileList | null) => {
    if (!list) return;
    const incoming = Array.from(list);
    setFiles(prev => {
      const existing = new Set(prev.map(f => f.name + f.size));
      return [...prev, ...incoming.filter(f => !existing.has(f.name + f.size))];
    });
  };

  const removeFile = (i: number) => setFiles(prev => prev.filter((_, idx) => idx !== i));

  return (
    <div className="mc-overlay" onClick={onClose}>
      <div className={`mc-panel${darkMode ? " dark" : ""}`} onClick={e => e.stopPropagation()}>

        <div className="mc-header">
          <div>
            <h2 className="mc-title">Añadir fuentes</h2>
            <p className="mc-subtitle">Sube documentos para indexar en tu colección</p>
          </div>
          <button className="mc-close" onClick={handleClose}><X size={18} /></button>
        </div>

        <div
          className={`mc-dropzone${isDragging ? " dragging" : ""}`}
          onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
          onDragEnter={e => { e.preventDefault(); setIsDragging(true); }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={e => { e.preventDefault(); setIsDragging(false); addFiles(e.dataTransfer.files); }}
          onClick={() => fileInputRef.current?.click()}
        >
          <input type="file" multiple hidden ref={fileInputRef} accept=".pdf,.docx,.doc,.txt,.csv" onChange={e => addFiles(e.target.files)} />
          <div className="mc-drop-icon"><CloudUpload size={26} /></div>
          <p className="mc-drop-title">{isDragging ? "Suelta los archivos aquí" : "Arrastra tus archivos aquí"}</p>
          <p className="mc-drop-sub">PDF, DOCX, TXT o CSV · Máx. 25 MB por archivo</p>
          <button className="mc-drop-btn" onClick={e => { e.stopPropagation(); fileInputRef.current?.click(); }}>
            Seleccionar archivos
          </button>
        </div>

        {files.length > 0 && (
          <div className="mc-file-list">
            {files.map((f, i) => (
              <div key={i} className="mc-file-item">
                <FileText size={14} className="mc-file-icon" />
                <span className="mc-file-name">{f.name}</span>
                <span className="mc-file-size">{formatSize(f.size)}</span>
                <button className="mc-file-remove" onClick={() => removeFile(i)}><Trash2 size={13} /></button>
              </div>
            ))}
          </div>
        )}

        <div className="mc-footer">
          <button className="mc-btn-cancel" onClick={handleClose}>Cancelar</button>
          <button className="mc-btn-upload" disabled={files.length === 0} onClick={() => { alert(`Simulación: ${files.length} archivo(s) enviado(s)`); handleClose(); }}>
            {files.length > 0 ? `Añadir ${files.length} archivo${files.length > 1 ? "s" : ""}` : "Añadir a la colección"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ModalCarga;