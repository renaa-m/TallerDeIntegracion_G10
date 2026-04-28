import { useState, useEffect } from 'react'
import { 
  useNavigate, 
  useParams, 
  useLocation, 
  useSearchParams 
} from 'react-router-dom'
import {
  Search,
  FileText,
  Network,
  ChevronRight,
  SlidersHorizontal,
  X,
  User,
  CalendarRange,
  Trash2,
  Flag
} from 'lucide-react'
import ModalNoDisponible from '../../components/modal_no_disponible/modal_no_disponible'
import ModalCarga from '../../components/modal_carga/modal_carga'
import './buscador_coleccion.css'

interface Fuente {
  id: number
  titulo: string
  tipo: string
  estado: 'ok' | 'error'
}

interface Resultado {
  id: number
  fuenteId: number
  fuenteTitulo: string
  fuenteTipo: string
  extracto: string
  pagina?: number
}

const FUENTES: Fuente[] = [
  { id: 1, titulo: 'Especificaciones Técnicas Dr. House', tipo: 'PDF', estado: 'ok' },
  { id: 2, titulo: 'Notas de Reunión IMFD', tipo: 'Doc', estado: 'ok' },
  { id: 3, titulo: 'Dataset H&M Chile - Outfits', tipo: 'CSV', estado: 'ok' },
  { id: 4, titulo: 'Manuscrito_Ilegible_1920.pdf', tipo: 'PDF', estado: 'error' },
]

const CORPUS: Resultado[] = [
  { id: 1, fuenteId: 1, fuenteTitulo: 'Especificaciones Técnicas Dr. House', fuenteTipo: 'PDF', extracto: 'El diagnóstico diferencial incluye lupus eritematoso sistémico, sarcoidosis y vasculitis...', pagina: 12 },
  { id: 2, fuenteId: 2, fuenteTitulo: 'Notas de Reunión IMFD', fuenteTipo: 'Doc', extracto: 'Se acordó presentar los avances del proyecto de análisis semántico en el congreso de junio.' }
]

function Highlight({ text, query }: { text: string; query: string }) {
  if (!query.trim()) return <>{text}</>
  const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi')
  const parts = text.split(regex)
  return (
    <>{parts.map((part, i) => regex.test(part) ? <mark key={i} className="bc-hl">{part}</mark> : part)}</>
  )
}

const BuscadorColeccion = () => {
  const { id_usuario } = useParams<{ id_usuario: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()

  const queryFromUrl = searchParams.get('q') ?? ''
  const [busqueda, setBusqueda] = useState(queryFromUrl)
  const [busquedaEnviada, setBusquedaEnviada] = useState(queryFromUrl)

  const [modalCargaOpen, setModalCargaOpen] = useState(location.state?.abrirModalCarga === true)
  const [modalGrafoOpen, setModalGrafoOpen] = useState(false)
  const [filtroBarra, setFiltroBarra] = useState('')
  const [filtroOpen, setFiltroOpen] = useState(false)
  const [fuenteActiva, setFuenteActiva] = useState<number | null>(null)

  const [personas, setPersonas] = useState<string[]>([])
  const [inputPersona, setInputPersona] = useState('')
  const [eventos, setEventos] = useState<string[]>([])
  const [inputEvento, setInputEvento] = useState('')
  const [fechaDesde, setFechaDesde] = useState('')
  const [fechaHasta, setFechaHasta] = useState('')

  const [darkMode, setDarkMode] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches)

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = (e: MediaQueryListEvent) => setDarkMode(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  const handleBuscar = () => {
    const trimmed = busqueda.trim()
    trimmed ? setSearchParams({ q: trimmed }) : setSearchParams({})
    setBusquedaEnviada(trimmed)
  }

  const handleBorrarColeccion = () => {
    if (window.confirm('¿Estás seguro de que quieres borrar esta colección permanentemente?')) {
      navigate(`/${id_usuario}`)
    }
  }

  const handleClearAllFilters = () => {
    setPersonas([]); setEventos([]); setFechaDesde(''); setFechaHasta('');
  }

  const agregarTag = (val: string, lista: string[], setLista: (v: string[]) => void, setInput: (v: string) => void) => {
    const trimmed = val.trim()
    if (trimmed && !lista.includes(trimmed)) setLista([...lista, trimmed])
    setInput('')
  }

  const hayFiltrosActivos = personas.length > 0 || eventos.length > 0 || !!fechaDesde || !!fechaHasta
  const fuentesFiltradas = FUENTES.filter((f) => f.titulo.toLowerCase().includes(filtroBarra.toLowerCase()))
  const resultados = CORPUS.filter((r) => {
    if (!busquedaEnviada.trim()) return false
    return (r.extracto + ' ' + r.fuenteTitulo).toLowerCase().includes(busquedaEnviada.toLowerCase())
  })

  return (
    <>
      <div className={`bc-root${darkMode ? ' bc-dark' : ''}`}>
        <aside className="bc-sidebar">
          <div className="bc-sidebar-inner">
            <button className="bc-add-btn" onClick={() => setModalGrafoOpen(true)}>
              <Network size={15} /> <span>Ver Grafo</span>
            </button>
            
            <button className="bc-delete-collection-btn" onClick={handleBorrarColeccion}>
              <Trash2 size={14} /> <span>Borrar colección</span>
            </button>

            <div className="bc-search-wrap">
              <Search size={13} className="bc-search-icon" />
              <input className="bc-search-input" placeholder="Mis Fuentes..." value={filtroBarra} onChange={(e) => setFiltroBarra(e.target.value)} />
            </div>

            <div className="bc-section-label">Fuentes · {fuentesFiltradas.length}</div>
            <div className="bc-sources-list">
              {fuentesFiltradas.map((f) => (
                <button key={f.id} className={`bc-source-item ${fuenteActiva === f.id ? 'active' : ''}`} onClick={() => setFuenteActiva(f.id)}>
                  <div className={`bc-source-dot ${f.estado === 'error' ? 'dot-error' : ''}`} />
                  <div className="bc-source-text">
                    <span className="bc-source-title">{f.titulo}</span>
                    <span className="bc-source-meta">{f.tipo}</span>
                  </div>
                  <ChevronRight size={11} className="bc-chevron" />
                </button>
              ))}
            </div>
          </div>
        </aside>

        <main className="bc-main">
          <div className="bc-searchbar-wrap">
            <div className="bc-searchbar">
              <Search size={17} className="bc-searchbar-icon" />
              <input className="bc-searchbar-input" placeholder="Busca en tus fuentes..." value={busqueda} onChange={(e) => setBusqueda(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleBuscar()} />
              <button className={`bc-filter-btn ${filtroOpen ? 'active' : ''} ${hayFiltrosActivos ? 'has-filters' : ''}`} onClick={() => setFiltroOpen(!filtroOpen)}>
                <SlidersHorizontal size={14} /> <span>Filtrar</span>
                {hayFiltrosActivos && <span className="bc-filter-badge">{personas.length + eventos.length + (fechaDesde || fechaHasta ? 1 : 0)}</span>}
              </button>
            </div>

            {filtroOpen && (
              <div className="bc-filter-panel">
                <div className="bc-filter-group">
                  <div className="bc-filter-group-header"><User size={12} /> <span className="bc-filter-label">Personas</span></div>
                  <input className="bc-filter-tag-input" placeholder="Añadir..." value={inputPersona} onChange={(e) => setInputPersona(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && agregarTag(inputPersona, personas, setPersonas, setInputPersona)} />
                  <div className="bc-filter-chips">{personas.map(p => <button key={p} className="bc-filter-chip selected" onClick={() => setPersonas(personas.filter(x => x !== p))}>{p} <X size={10} /></button>)}</div>
                </div>
                <div className="bc-filter-divider" />
                <div className="bc-filter-group">
                  <div className="bc-filter-group-header"><Flag size={12} /> <span className="bc-filter-label">Eventos</span></div>
                  <input className="bc-filter-tag-input" placeholder="Añadir..." value={inputEvento} onChange={(e) => setInputEvento(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && agregarTag(inputEvento, eventos, setEventos, setInputEvento)} />
                  <div className="bc-filter-chips">{eventos.map(e => <button key={e} className="bc-filter-chip selected" onClick={() => setEventos(eventos.filter(x => x !== e))}>{e} <X size={10} /></button>)}</div>
                </div>
                <div className="bc-filter-divider" />
                <div className="bc-filter-group">
                  <div className="bc-filter-group-header"><CalendarRange size={12} /> <span className="bc-filter-label">Fechas</span></div>
                  <div className="bc-filter-date-row">
                    <input type="date" value={fechaDesde} onChange={(e) => setFechaDesde(e.target.value)} className="bc-filter-date" />
                    <span className="bc-filter-date-sep">→</span>
                    <input type="date" value={fechaHasta} onChange={(e) => setFechaHasta(e.target.value)} className="bc-filter-date" />
                  </div>
                </div>
                <div className="bc-filter-footer-actions">
                  {hayFiltrosActivos && (
                    <button className="bc-filter-clear-all-link" onClick={handleClearAllFilters}>
                      <Trash2 size={12} /> Limpiar filtros
                    </button>
                  )}
                  <button className="bc-filter-save-btn" onClick={() => setFiltroOpen(false)}>Guardar filtros</button>
                </div>
              </div>
            )}
          </div>

          <div className="bc-results-area">
            {resultados.length > 0 ? (
              <div className="bc-results-list">
                {resultados.map((r) => (
                  <article key={r.id} className="bc-result-card">
                    <div className="bc-result-source"><span className="bc-result-source-name">{r.fuenteTitulo}</span><span className="bc-result-badge">{r.fuenteTipo}</span></div>
                    <p className="bc-result-excerpt"><Highlight text={r.extracto} query={busquedaEnviada} /></p>
                  </article>
                ))}
              </div>
            ) : (
              <div className="bc-empty">
                <div className="bc-empty-icon"><Search size={26} /></div>
                <p className="bc-empty-title">Busca en tu colección</p>
              </div>
            )}
          </div>
        </main>
      </div>
      <ModalNoDisponible isOpen={modalGrafoOpen} onClose={() => setModalGrafoOpen(false)} />
      <ModalCarga isOpen={modalCargaOpen} onClose={() => setModalCargaOpen(false)} darkMode={darkMode} />
    </>
  )
}

export default BuscadorColeccion;