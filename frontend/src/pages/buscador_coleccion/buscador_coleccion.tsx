import { useState, useEffect, useMemo } from 'react'
import {
  useNavigate,
  useParams,
  useLocation,
  useSearchParams,
} from 'react-router-dom'
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

// --- MOCKS ---
const FUENTES: Fuente[] = [
  {
    id: 1,
    titulo: 'Especificaciones Técnicas Dr. House',
    tipo: 'PDF',
    estado: 'ok',
  },
  { id: 2, titulo: 'Notas de Reunión IMFD', tipo: 'Doc', estado: 'ok' },
  { id: 3, titulo: 'Dataset H&M Chile - Outfits', tipo: 'CSV', estado: 'ok' },
  {
    id: 4,
    titulo: 'Manuscrito_Ilegible_1920.pdf',
    tipo: 'PDF',
    estado: 'error',
  },
]

const CORPUS: Resultado[] = [
  {
    id: 1,
    fuenteId: 1,
    fuenteTitulo: 'Especificaciones Técnicas Dr. House',
    fuenteTipo: 'PDF',
    extracto:
      'El diagnóstico diferencial incluye lupus eritematoso sistémico, sarcoidosis y vasculitis.',
    pagina: 12,
  },
  {
    id: 2,
    fuenteId: 2,
    fuenteTitulo: 'Notas de Reunión IMFD',
    fuenteTipo: 'Doc',
    extracto:
      'Se acordó presentar los avances del proyecto de análisis semántico en el congreso de junio.',
  },
  {
    id: 3,
    fuenteId: 1,
    fuenteTitulo: 'Especificaciones Técnicas Dr. House',
    fuenteTipo: 'PDF',
    extracto:
      'El paciente presenta fiebre persistente y erupciones cutáneas compatibles con diagnóstico autoinmune.',
    pagina: 3,
  },
  {
    id: 4,
    fuenteId: 2,
    fuenteTitulo: 'Notas de Reunión IMFD',
    fuenteTipo: 'Doc',
    extracto:
      'El equipo de grafos de conocimiento presentará resultados preliminares en la próxima reunión semanal.',
  },
  {
    id: 5,
    fuenteId: 3,
    fuenteTitulo: 'Dataset H&M Chile - Outfits',
    fuenteTipo: 'CSV',
    extracto:
      'Registro de 1.200 combinaciones de prendas evaluadas por usuarios en Santiago durante 2023.',
  },
]

// --- SUB-COMPONENTES HELPER ---
function Highlight({ text, query }: { text: string; query: string }) {
  if (!query.trim()) return <>{text}</>
  const regex = new RegExp(
    `(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`,
    'gi',
  )
  const parts = text.split(regex)
  return (
    <>
      {parts.map((part, i) =>
        regex.test(part) ? (
          <mark key={i} className="bc-hl">
            {part}
          </mark>
        ) : (
          part
        ),
      )}
    </>
  )
}

function matcheaBusqueda(resultado: Resultado, query: string): boolean {
  if (!query.trim()) return false
  const haystack = (
    resultado.extracto +
    ' ' +
    resultado.fuenteTitulo
  ).toLowerCase()
  const palabras = query.toLowerCase().trim().split(/\s+/)
  return palabras.some((p) => p.length > 1 && haystack.includes(p))
}

// --- COMPONENTE PRINCIPAL ---
const BuscadorColeccion = () => {
  const { id_usuario } = useParams<{ id_usuario: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()

  // Estados de Nombre de Colección (Nuevo)
  const [nombreColeccion, setNombreColeccion] = useState(
    'Investigación IMFD 2024',
  )
  const [isEditingName, setIsEditingName] = useState(false)
  const [tempNombre, setTempNombre] = useState(nombreColeccion)

  // Estados de Búsqueda
  const queryFromUrl = searchParams.get('q') ?? ''
  const [busqueda, setBusqueda] = useState(queryFromUrl)
  const [busquedaEnviada, setBusquedaEnviada] = useState(queryFromUrl)

  // Estados de Modales
  const [modalCargaOpen, setModalCargaOpen] = useState(
    location.state?.abrirModalCarga === true,
  )
  const [modalGrafoOpen, setModalGrafoOpen] = useState(false)
  const [isEliminarModalOpen, setIsEliminarModalOpen] = useState(false)
  const [isModalFuentesOpen, setIsModalFuentesOpen] = useState(false)

  // Estados de Filtros
  const [filtroOpen, setFiltroOpen] = useState(false)
  const [personas, setPersonas] = useState<string[]>([])
  const [inputPersona, setInputPersona] = useState('')
  const [eventos, setEventos] = useState<string[]>([])
  const [inputEvento, setInputEvento] = useState('')
  const [fechaDesde, setFechaDesde] = useState('')
  const [fechaHasta, setFechaHasta] = useState('')

  const [darkMode, setDarkMode] = useState(
    () => window.matchMedia('(prefers-color-scheme: dark)').matches,
  )

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = (e: MediaQueryListEvent) => setDarkMode(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  // Manejadores
  const handleBuscar = (valor: string) => {
    const trimmed = valor.trim()
    trimmed ? setSearchParams({ q: trimmed }) : setSearchParams({})
    setBusquedaEnviada(trimmed)
  }

  const saveNombre = () => {
    if (tempNombre.trim()) setNombreColeccion(tempNombre)
    setIsEditingName(false)
  }

  const confirmarBorrado = () => {
    setIsEliminarModalOpen(false)
    navigate(`/${id_usuario}`)
  }

  const handleClearAllFilters = () => {
    setPersonas([])
    setEventos([])
    setFechaDesde('')
    setFechaHasta('')
  }

  const agregarTag = (
    val: string,
    lista: string[],
    setLista: (v: string[]) => void,
    setInput: (v: string) => void,
  ) => {
    const trimmed = val.trim()
    if (trimmed && !lista.includes(trimmed)) setLista([...lista, trimmed])
    setInput('')
  }

  const hayFiltrosActivos =
    personas.length > 0 || eventos.length > 0 || !!fechaDesde || !!fechaHasta
  const resultados = useMemo(
    () => CORPUS.filter((r) => matcheaBusqueda(r, busquedaEnviada)),
    [busquedaEnviada],
  )

  return (
    <>
      <div className={`bc-root${darkMode ? ' bc-dark' : ''}`}>
        <aside className="bc-sidebar">
          <div className="bc-sidebar-inner">
            {/* --- CABECERA DE COLECCIÓN CON EDICIÓN --- */}
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
                  <button className="bc-save-name-btn" onClick={saveNombre}>
                    <Check size={14} />
                  </button>
                </div>
              ) : (
                <div
                  className="bc-sidebar-title-group"
                  onClick={() => {
                    setIsEditingName(true)
                    setTempNombre(nombreColeccion)
                  }}
                >
                  <h2 className="bc-sidebar-collection-name">
                    {nombreColeccion}
                  </h2>
                  <button className="bc-edit-name-icon-btn">
                    <Edit2 size={12} />
                  </button>
                </div>
              )}
              <span className="bc-sidebar-collection-label">
                Colección actual
              </span>
            </div>

            <div className="bc-sidebar-divider" />

            <button
              className="bc-add-btn"
              onClick={() => setModalGrafoOpen(true)}
            >
              <Network size={15} /> <span>Ver Grafo</span>
            </button>

            <button
              className="bc-add-btn"
              onClick={() => setIsModalFuentesOpen(true)}
            >
              <Files size={15} /> <span>Ver Documentos</span>
            </button>

            <button
              className="bc-delete-collection-btn"
              onClick={() => setIsEliminarModalOpen(true)}
            >
              <Trash2 size={14} /> <span>Borrar colección</span>
            </button>

            <div className="bc-sidebar-divider" />
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
                onKeyDown={(e) =>
                  e.key === 'Enter' && handleBuscar(e.currentTarget.value)
                }
              />
              <button
                className={`bc-filter-btn ${filtroOpen ? 'active' : ''} ${hayFiltrosActivos ? 'has-filters' : ''}`}
                onClick={() => setFiltroOpen(!filtroOpen)}
              >
                <SlidersHorizontal size={14} /> <span>Filtrar</span>
                {hayFiltrosActivos && (
                  <span className="bc-filter-badge">
                    {personas.length +
                      eventos.length +
                      (fechaDesde || fechaHasta ? 1 : 0)}
                  </span>
                )}
              </button>
            </div>

            {filtroOpen && (
              <div className="bc-filter-panel">
                <div className="bc-filter-group">
                  <div className="bc-filter-group-header">
                    <User size={12} />{' '}
                    <span className="bc-filter-label">Personas</span>
                  </div>
                  <input
                    className="bc-filter-tag-input"
                    placeholder="Añadir..."
                    value={inputPersona}
                    onChange={(e) => setInputPersona(e.target.value)}
                    onKeyDown={(e) =>
                      e.key === 'Enter' &&
                      agregarTag(
                        inputPersona,
                        personas,
                        setPersonas,
                        setInputPersona,
                      )
                    }
                  />
                  <div className="bc-filter-chips">
                    {personas.map((p) => (
                      <button
                        key={p}
                        className="bc-filter-chip selected"
                        onClick={() =>
                          setPersonas(personas.filter((x) => x !== p))
                        }
                      >
                        {p} <X size={10} />
                      </button>
                    ))}
                  </div>
                </div>
                <div className="bc-filter-divider" />
                <div className="bc-filter-group">
                  <div className="bc-filter-group-header">
                    <Flag size={12} />{' '}
                    <span className="bc-filter-label">Eventos</span>
                  </div>
                  <input
                    className="bc-filter-tag-input"
                    placeholder="Añadir..."
                    value={inputEvento}
                    onChange={(e) => setInputEvento(e.target.value)}
                    onKeyDown={(e) =>
                      e.key === 'Enter' &&
                      agregarTag(
                        inputEvento,
                        eventos,
                        setEventos,
                        setInputEvento,
                      )
                    }
                  />
                  <div className="bc-filter-chips">
                    {eventos.map((e) => (
                      <button
                        key={e}
                        className="bc-filter-chip selected"
                        onClick={() =>
                          setEventos(eventos.filter((x) => x !== e))
                        }
                      >
                        {e} <X size={10} />
                      </button>
                    ))}
                  </div>
                </div>
                <div className="bc-filter-divider" />
                <div className="bc-filter-group">
                  <div className="bc-filter-group-header">
                    <CalendarRange size={12} />{' '}
                    <span className="bc-filter-label">Fechas</span>
                  </div>
                  <div className="bc-filter-date-row">
                    <input
                      type="date"
                      value={fechaDesde}
                      onChange={(e) => setFechaDesde(e.target.value)}
                      className="bc-filter-date"
                    />
                    <span className="bc-filter-date-sep">→</span>
                    <input
                      type="date"
                      value={fechaHasta}
                      onChange={(e) => setFechaHasta(e.target.value)}
                      className="bc-filter-date"
                    />
                  </div>
                </div>
                <div className="bc-filter-footer-actions">
                  {hayFiltrosActivos && (
                    <button
                      className="bc-filter-clear-all-link"
                      onClick={handleClearAllFilters}
                    >
                      <Trash2 size={12} /> Limpiar filtros
                    </button>
                  )}
                  <button
                    className="bc-filter-save-btn"
                    onClick={() => setFiltroOpen(false)}
                  >
                    Guardar filtros
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="bc-results-area">
            {resultados.length > 0 ? (
              <div className="bc-results-list">
                {resultados.map((r) => (
                  <article key={r.id} className="bc-result-card">
                    <div className="bc-result-source">
                      <span className="bc-result-source-name">
                        {r.fuenteTitulo}
                      </span>
                      <span className="bc-result-badge">{r.fuenteTipo}</span>
                    </div>
                    <p className="bc-result-excerpt">
                      <Highlight text={r.extracto} query={busquedaEnviada} />
                    </p>
                  </article>
                ))}
              </div>
            ) : (
              <div className="bc-empty">
                <div className="bc-empty-icon">
                  <Search size={26} />
                </div>
                <p className="bc-empty-title">
                  {busquedaEnviada.trim()
                    ? 'No se encontraron resultados'
                    : 'Busca en tu colección'}
                </p>
              </div>
            )}
          </div>
        </main>
      </div>

      {/* MODALES */}
      <ModalNoDisponible
        isOpen={modalGrafoOpen}
        onClose={() => setModalGrafoOpen(false)}
      />
      <ModalCarga
        isOpen={modalCargaOpen}
        onClose={() => setModalCargaOpen(false)}
        darkMode={darkMode}
      />
      <ModalEliminarColeccion
        isOpen={isEliminarModalOpen}
        onClose={() => setIsEliminarModalOpen(false)}
        onConfirm={confirmarBorrado}
        nombreColeccion={nombreColeccion}
      />
      <ModalDocumentosDisponibles
        isOpen={isModalFuentesOpen}
        fuentes={FUENTES}
        onClose={() => setIsModalFuentesOpen(false)}
        darkMode={darkMode}
      />
    </>
  )
}

export default BuscadorColeccion
