import { useState, useEffect, useMemo, useCallback } from 'react'
import { useNavigate, useParams, useLocation, useSearchParams } from 'react-router-dom'
import { useAuth0 } from '@auth0/auth0-react'
import {
  Search,
  Network,
  SlidersHorizontal,
  X,
  User,
  CalendarRange,
  Trash2,
  Flag,
  Files,
  Edit2,
  Check,
} from 'lucide-react'

// Componentes
import ModalNoDisponible from '../../components/modal_no_disponible/modal_no_disponible'
import ModalCarga from '../../components/modal_carga/modal_carga'
import ModalEliminarColeccion from '../../components/modal_eliminar_coleccion/modal_eliminar_coleccion'
import ModalDocumentosDisponibles from '../../components/modal_documentos_disponibles/modal_documentos_disponibles'

// Estilos
import './buscador_coleccion.css'

// --- INTERFACES ---
interface Fuente {
  id: string
  filename: string
  file_type: string
  status: string
}

// --- SUB-COMPONENTES HELPER ---
function Highlight({ text, query }: { text: string; query: string }) {
  if (!query.trim()) return <>{text}</>
  const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi')
  const parts = text.split(regex)
  return (
    <>
      {parts.map((part, i) =>
        regex.test(part) ? <mark key={i} className="bc-hl">{part}</mark> : part
      )}
    </>
  )
}

const BuscadorColeccion = () => {
  const { id_usuario, id_coleccion } = useParams<{ id_usuario: string; id_coleccion: string }>()
  const { getAccessTokenSilently } = useAuth0()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()

  // --- ESTADOS DE DATOS ---
  const [nombreColeccion, setNombreColeccion] = useState('Nueva Colección')
  const [fuentes, setFuentes] = useState<Fuente[]>([])
  const [resultados, setResultados] = useState<any[]>([]) 

  // --- ESTADOS DE UI ---
  const [isEditingName, setIsEditingName] = useState(false)
  const [tempNombre, setTempNombre] = useState(nombreColeccion)
  
  const queryFromUrl = searchParams.get('q') ?? ''
  const [busqueda, setBusqueda] = useState(queryFromUrl)
  const [busquedaEnviada, setBusquedaEnviada] = useState(queryFromUrl)

  const [modalCargaOpen, setModalCargaOpen] = useState(id_coleccion === 'nueva')
  const [modalGrafoOpen, setModalGrafoOpen] = useState(false)
  const [isEliminarModalOpen, setIsEliminarModalOpen] = useState(false)
  const [isModalFuentesOpen, setIsModalFuentesOpen] = useState(false)

  // --- ESTADOS DE FILTROS REALES (Los que afectan la búsqueda) ---
  const [filtroOpen, setFiltroOpen] = useState(false)
  const [personas, setPersonas] = useState<string[]>([])
  const [eventos, setEventos] = useState<string[]>([])
  const [fechaDesde, setFechaDesde] = useState('')
  const [fechaHasta, setFechaHasta] = useState('')

  // --- ESTADOS DE FILTROS TEMPORALES (Solo para la UI del panel) ---
  const [tempPersonas, setTempPersonas] = useState<string[]>([])
  const [inputPersona, setInputPersona] = useState('')
  const [tempEventos, setTempEventos] = useState<string[]>([])
  const [inputEvento, setInputEvento] = useState('')
  const [tempFechaDesde, setTempFechaDesde] = useState('')
  const [tempFechaHasta, setTempFechaHasta] = useState('')

  const [darkMode] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches)

  // Sincronizar temporales al abrir el panel
  useEffect(() => {
    if (filtroOpen) {
      setTempPersonas(personas)
      setTempEventos(eventos)
      setTempFechaDesde(fechaDesde)
      setTempFechaHasta(fechaHasta)
    }
  }, [filtroOpen, personas, eventos, fechaDesde, fechaHasta])

  // --- CARGA DE DATOS ---
  const cargarDatos = useCallback(async () => {
    if (!id_coleccion || id_coleccion === 'nueva') return
    try {
      const token = await getAccessTokenSilently()
      const headers = { Authorization: `Bearer ${token}` }

      const resColl = await fetch(`http://localhost:8000/api/collections/${id_coleccion}`, { headers })
      if (resColl.ok) {
        const data = await resColl.json()
        setNombreColeccion(data.name)
        setTempNombre(data.name)
      }

      const resDocs = await fetch(`http://localhost:8000/api/documentos?coleccion_id=${id_coleccion}`, { headers })
      if (resDocs.ok) {
        setFuentes(await resDocs.json())
      }
    } catch (e) { console.error("Error cargando colección:", e) }
  }, [id_coleccion, getAccessTokenSilently])

  useEffect(() => { cargarDatos() }, [cargarDatos])

  // --- MANEJADORES ---
  const handleBuscar = (valor: string) => {
    const trimmed = valor.trim()
    setSearchParams(trimmed ? { q: trimmed } : {})
    setBusquedaEnviada(trimmed)
  }

  const saveNombre = async () => {
    if (tempNombre.trim() && id_coleccion !== 'nueva') {
      try {
        const token = await getAccessTokenSilently()
        await fetch(`http://localhost:8000/api/collections/${id_coleccion}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ name: tempNombre })
        })
        setNombreColeccion(tempNombre)
      } catch (e) { console.error(e) }
    }
    setIsEditingName(false)
  }

  const handleClearAllFilters = () => {
    setPersonas([]); setEventos([]); setFechaDesde(''); setFechaHasta('')
    setTempPersonas([]); setTempEventos([]); setTempFechaDesde(''); setTempFechaHasta('')
  }

  const handleSaveFilters = () => {
    setPersonas(tempPersonas)
    setEventos(tempEventos)
    setFechaDesde(tempFechaDesde)
    setFechaHasta(tempFechaHasta)
    setFiltroOpen(false)
    // Opcional: disparar búsqueda aquí
  }

  const agregarTag = (val: string, lista: string[], setLista: (v: string[]) => void, setInput: (v: string) => void) => {
    const trimmed = val.trim()
    if (trimmed && !lista.includes(trimmed)) setLista([...lista, trimmed])
    setInput('')
  }

  const hayFiltrosActivos = personas.length > 0 || eventos.length > 0 || !!fechaDesde || !!fechaHasta

  return (
    <>
      <div className={`bc-root${darkMode ? ' bc-dark' : ''}`}>
        <aside className="bc-sidebar">
          <div className="bc-sidebar-inner">
            <div className="bc-sidebar-header">
              {isEditingName ? (
                <div className="bc-edit-name-container">
                  <input
                    className="bc-sidebar-name-input"
                    value={tempNombre}
                    onChange={(e) => setTempNombre(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && saveNombre()}
                    autoFocus
                  />
                  <button className="bc-save-name-btn" onClick={saveNombre}><Check size={14} /></button>
                </div>
              ) : (
                <div className="bc-sidebar-title-group" onClick={() => { setIsEditingName(true); setTempNombre(nombreColeccion) }}>
                  <h2 className="bc-sidebar-collection-name">{nombreColeccion}</h2>
                  <button className="bc-edit-name-icon-btn"><Edit2 size={12} /></button>
                </div>
              )}
              <span className="bc-sidebar-collection-label">Colección actual</span>
            </div>

            <div className="bc-sidebar-divider" />
            <button className="bc-add-btn" onClick={() => setModalGrafoOpen(true)}>
              <Network size={15} /> <span>Ver Grafo</span>
            </button>
            <button className="bc-add-btn" onClick={() => setIsModalFuentesOpen(true)}>
              <Files size={15} /> <span>Ver Documentos</span>
            </button>
            <button className="bc-delete-collection-btn" onClick={() => setIsEliminarModalOpen(true)}>
              <Trash2 size={14} /> <span>Borrar colección</span>
            </button>
          </div>
        </aside>

        <main className="bc-main">
          <div className="bc-searchbar-wrap">
            <div className="bc-searchbar">
              <Search size={17} className="bc-searchbar-icon" />
              <input
                className="bc-searchbar-input"
                placeholder="Busca en tus fuentes..."
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleBuscar(e.currentTarget.value)}
              />
              <button
                className={`bc-filter-btn ${filtroOpen ? 'active' : ''} ${hayFiltrosActivos ? 'has-filters' : ''}`}
                onClick={() => setFiltroOpen(!filtroOpen)}
              >
                <SlidersHorizontal size={14} /> <span>Filtrar</span>
                {hayFiltrosActivos && (
                  <span className="bc-filter-badge">
                    {personas.length + eventos.length + (fechaDesde || fechaHasta ? 1 : 0)}
                  </span>
                )}
              </button>
            </div>

            {filtroOpen && (
              <div className="bc-filter-panel">
                <div className="bc-filter-group">
                  <div className="bc-filter-group-header"><User size={12} /> <span className="bc-filter-label">Personas</span></div>
                  <input
                    className="bc-filter-tag-input"
                    placeholder="Añadir..."
                    value={inputPersona}
                    onChange={(e) => setInputPersona(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && agregarTag(inputPersona, tempPersonas, setTempPersonas, setInputPersona)}
                  />
                  <div className="bc-filter-chips">
                    {tempPersonas.map((p) => (
                      <button key={p} className="bc-filter-chip selected" onClick={() => setTempPersonas(tempPersonas.filter((x) => x !== p))}>
                        {p} <X size={10} />
                      </button>
                    ))}
                  </div>
                </div>
                <div className="bc-filter-divider" />
                <div className="bc-filter-group">
                  <div className="bc-filter-group-header"><Flag size={12} /> <span className="bc-filter-label">Eventos</span></div>
                  <input
                    className="bc-filter-tag-input"
                    placeholder="Añadir..."
                    value={inputEvento}
                    onChange={(e) => setInputEvento(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && agregarTag(inputEvento, tempEventos, setTempEventos, setInputEvento)}
                  />
                  <div className="bc-filter-chips">
                    {tempEventos.map((e) => (
                      <button key={e} className="bc-filter-chip selected" onClick={() => setTempEventos(tempEventos.filter((x) => x !== e))}>
                        {e} <X size={10} />
                      </button>
                    ))}
                  </div>
                </div>
                <div className="bc-filter-divider" />
                <div className="bc-filter-group">
                  <div className="bc-filter-group-header"><CalendarRange size={12} /> <span className="bc-filter-label">Fechas</span></div>
                  <div className="bc-filter-date-row">
                    <input type="date" value={tempFechaDesde} onChange={(e) => setTempFechaDesde(e.target.value)} className="bc-filter-date" />
                    <span className="bc-filter-date-sep">→</span>
                    <input type="date" value={tempFechaHasta} onChange={(e) => setTempFechaHasta(e.target.value)} className="bc-filter-date" />
                  </div>
                </div>
                <div className="bc-filter-footer-actions">
                  {(tempPersonas.length > 0 || tempEventos.length > 0 || !!tempFechaDesde || !!tempFechaHasta) && (
                    <button className="bc-filter-clear-all-link" onClick={handleClearAllFilters}>
                      <Trash2 size={12} /> Limpiar filtros
                    </button>
                  )}
                  <button className="bc-filter-save-btn" onClick={handleSaveFilters}>Guardar filtros</button>
                </div>
              </div>
            )}
          </div>

          <div className="bc-results-area">
            {resultados.length > 0 ? (
              <div className="bc-results-list">
                {resultados.map((r, idx) => (
                  <article key={idx} className="bc-result-card">
                    <div className="bc-result-source">
                      <span className="bc-result-source-name">{r.fuente_nombre}</span>
                      <span className="bc-result-badge">{r.tipo}</span>
                    </div>
                    <p className="bc-result-excerpt">
                      <Highlight text={r.texto} query={busquedaEnviada} />
                    </p>
                  </article>
                ))}
              </div>
            ) : (
              <div className="bc-empty">
                <div className="bc-empty-icon"><Search size={26} /></div>
                <p className="bc-empty-title">
                  {busquedaEnviada.trim() ? 'No hay resultados' : 'Busca en tu colección'}
                </p>
              </div>
            )}
          </div>
        </main>
      </div>

      <ModalNoDisponible isOpen={modalGrafoOpen} onClose={() => setModalGrafoOpen(false)} />
      <ModalCarga 
        isOpen={modalCargaOpen} 
        onClose={() => setModalCargaOpen(false)} 
        coleccionId={id_coleccion || ''} 
        darkMode={darkMode} 
      />
      <ModalEliminarColeccion
        isOpen={isEliminarModalOpen}
        onClose={() => setIsEliminarModalOpen(false)}
        onConfirm={() => {/* implementar borrado */}}
        nombreColeccion={nombreColeccion}
      />
      <ModalDocumentosDisponibles
        isOpen={isModalFuentesOpen}
        fuentes={fuentes}
        onClose={() => setIsModalFuentesOpen(false)}
        darkMode={darkMode}
      />
    </>
  )
}

export default BuscadorColeccion