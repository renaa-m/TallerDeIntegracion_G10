import { useState, useEffect } from 'react'
import {
  Search,
  FileText,
  Network,
  ChevronRight,
  SlidersHorizontal,
  X,
  User,
  CalendarRange,
  Zap,
} from 'lucide-react'
//import { useParams } from "react-router-dom";
//import { useAuth0 } from "@auth0/auth0-react";
import ModalNoDisponible from '../../components/modal_no_disponible/modal_no_disponible'
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
      'El diagnóstico diferencial incluye lupus eritematoso sistémico, sarcoidosis y vasculitis. El equipo de reumatología sugiere iniciar con prednisona 40mg diarios.',
    pagina: 12,
  },
  {
    id: 2,
    fuenteId: 1,
    fuenteTitulo: 'Especificaciones Técnicas Dr. House',
    fuenteTipo: 'PDF',
    extracto:
      'Resultados de laboratorio muestran ANA positivo 1:640 con patrón homogéneo, complemento C3 bajo y anti-dsDNA elevado.',
    pagina: 18,
  },
  {
    id: 3,
    fuenteId: 2,
    fuenteTitulo: 'Notas de Reunión IMFD',
    fuenteTipo: 'Doc',
    extracto:
      'Se acordó presentar los avances del proyecto de análisis semántico en el congreso de junio. Responsable: equipo de NLP.',
  },
  {
    id: 4,
    fuenteId: 2,
    fuenteTitulo: 'Notas de Reunión IMFD',
    fuenteTipo: 'Doc',
    extracto:
      'Hito de junio: entrega de prototipo funcional del motor de búsqueda con indexación de al menos 500 documentos.',
  },
  {
    id: 5,
    fuenteId: 3,
    fuenteTitulo: 'Dataset H&M Chile - Outfits',
    fuenteTipo: 'CSV',
    extracto:
      'Columnas: article_id, product_type_name, colour_group_name, perceived_colour_value. Total filas: 105.542.',
  },
  {
    id: 6,
    fuenteId: 3,
    fuenteTitulo: 'Dataset H&M Chile - Outfits',
    fuenteTipo: 'CSV',
    extracto:
      'El 34% de los artículos pertenece a la categoría Ladieswear, seguido por Divided (22%) y Menswear (18%).',
  },
]

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

const BuscadorColeccion = () => {
  //const { id_usuario } = useParams();
  //const { user } = useAuth0();

  const [modalGrafoOpen, setModalGrafoOpen] = useState(false)
  const [filtroBarra, setFiltroBarra] = useState('')

  // busqueda: valor en tiempo real del input
  // busquedaEnviada: valor que dispara resultados (solo al presionar Enter)
  const [busqueda, setBusqueda] = useState('')
  const [busquedaEnviada, setBusquedaEnviada] = useState('')

  const [filtroOpen, setFiltroOpen] = useState(false)
  const [fuenteActiva, setFuenteActiva] = useState<number | null>(null)

  // Filtros
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

  const quitarTag = (
    val: string,
    lista: string[],
    setLista: (v: string[]) => void,
  ) => setLista(lista.filter((x) => x !== val))

  const handleBuscar = () => {
    setBusquedaEnviada(busqueda)
  }

  const handleClearBusqueda = () => {
    setBusqueda('')
    setBusquedaEnviada('')
  }

  const hayFiltrosActivos =
    personas.length > 0 || eventos.length > 0 || !!fechaDesde || !!fechaHasta

  const fuentesFiltradas = FUENTES.filter((f) =>
    f.titulo.toLowerCase().includes(filtroBarra.toLowerCase()),
  )

  // Resultados solo se derivan de busquedaEnviada, nunca de busqueda
  const buscando = busquedaEnviada.trim().length > 0

  const resultados = CORPUS.filter((r) => {
    if (!buscando) return false
    const texto = (r.extracto + ' ' + r.fuenteTitulo).toLowerCase()
    const matchBusqueda = texto.includes(busquedaEnviada.toLowerCase())
    const matchPersonas =
      personas.length === 0 ||
      personas.some((p) => texto.includes(p.toLowerCase()))
    const matchEventos =
      eventos.length === 0 ||
      eventos.some((e) => texto.includes(e.toLowerCase()))
    // fechas: lógica lista para conectar a metadatos reales
    // const matchFecha = (!fechaDesde || r.fecha >= fechaDesde) && (!fechaHasta || r.fecha <= fechaHasta)
    return matchBusqueda && matchPersonas && matchEventos
  })

  return (
    <>
      <div className={`bc-root${darkMode ? ' bc-dark' : ''}`}>
        {/* SIDEBAR */}
        <aside className="bc-sidebar">
          <div className="bc-sidebar-inner">
            <button
              className="bc-add-btn"
              type="button"
              onClick={() => setModalGrafoOpen(true)}
            >
              <Network size={15} />
              <span>Ver Grafo</span>
            </button>

            <div className="bc-search-wrap">
              <Search size={13} className="bc-search-icon" />
              <input
                className="bc-search-input"
                type="text"
                placeholder="Mis Fuentes..."
                value={filtroBarra}
                onChange={(e) => setFiltroBarra(e.target.value)}
              />
            </div>

            <div className="bc-section-label">
              Fuentes · {fuentesFiltradas.length}
            </div>

            <div className="bc-sources-list">
              {fuentesFiltradas.map((f, i) => (
                <button
                  key={f.id}
                  className={`bc-source-item${fuenteActiva === f.id ? ' active' : ''}${f.estado === 'error' ? ' error' : ''}`}
                  style={{ animationDelay: `${i * 50}ms` }}
                  onClick={() =>
                    setFuenteActiva(fuenteActiva === f.id ? null : f.id)
                  }
                >
                  <div
                    className={`bc-source-dot${f.estado === 'error' ? ' dot-error' : ''}`}
                  />
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

        {/* MAIN */}
        <main className="bc-main">
          <header className="bc-topbar">
            <div className="bc-topbar-left">
              <h1 className="bc-topbar-title">Buscador Semántico</h1>
              <span className="bc-topbar-sub">
                Colección activa ·{' '}
                {FUENTES.filter((f) => f.estado === 'ok').length} fuentes
              </span>
            </div>
            <button
              className="bc-graph-btn"
              onClick={() => setModalGrafoOpen(true)}
            >
              <Network size={15} />
              <span>Ver Grafo</span>
            </button>
          </header>

          <div className="bc-searchbar-wrap">
            <div className="bc-searchbar">
              <Search size={17} className="bc-searchbar-icon" />
              <input
                className="bc-searchbar-input"
                type="text"
                placeholder="Busca en tus fuentes..."
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleBuscar()
                }}
                autoFocus
              />
              {busqueda && (
                <button
                  className="bc-searchbar-clear"
                  onClick={handleClearBusqueda}
                >
                  <X size={14} />
                </button>
              )}
              <div className="bc-searchbar-divider" />
              <button
                className={`bc-filter-btn${filtroOpen ? ' active' : ''}${hayFiltrosActivos ? ' has-filters' : ''}`}
                onClick={() => setFiltroOpen(!filtroOpen)}
              >
                <SlidersHorizontal size={14} />
                <span>Filtrar</span>
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
                {/* ── Personas ── */}
                <div className="bc-filter-group">
                  <div className="bc-filter-group-header">
                    <User size={12} />
                    <span className="bc-filter-label">Personas de interés</span>
                  </div>
                  <div className="bc-filter-tag-row">
                    <input
                      className="bc-filter-tag-input"
                      type="text"
                      placeholder="Escribe un nombre y presiona Enter..."
                      value={inputPersona}
                      onChange={(e) => setInputPersona(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter')
                          agregarTag(
                            inputPersona,
                            personas,
                            setPersonas,
                            setInputPersona,
                          )
                      }}
                    />
                  </div>
                  {personas.length > 0 && (
                    <div className="bc-filter-chips">
                      {personas.map((p) => (
                        <button
                          key={p}
                          className="bc-filter-chip selected"
                          onClick={() => quitarTag(p, personas, setPersonas)}
                        >
                          {p}
                          <X size={10} />
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div className="bc-filter-divider" />

                {/* ── Fechas ── */}
                <div className="bc-filter-group">
                  <div className="bc-filter-group-header">
                    <CalendarRange size={12} />
                    <span className="bc-filter-label">Rango de fechas</span>
                  </div>
                  <div className="bc-filter-date-row">
                    <input
                      className="bc-filter-date"
                      type="date"
                      value={fechaDesde}
                      onChange={(e) => setFechaDesde(e.target.value)}
                    />
                    <span className="bc-filter-date-sep">→</span>
                    <input
                      className="bc-filter-date"
                      type="date"
                      value={fechaHasta}
                      onChange={(e) => setFechaHasta(e.target.value)}
                    />
                    {(fechaDesde || fechaHasta) && (
                      <button
                        className="bc-filter-date-clear"
                        onClick={() => {
                          setFechaDesde('')
                          setFechaHasta('')
                        }}
                      >
                        <X size={12} />
                      </button>
                    )}
                  </div>
                </div>

                <div className="bc-filter-divider" />

                {/* ── Eventos ── */}
                <div className="bc-filter-group">
                  <div className="bc-filter-group-header">
                    <Zap size={12} />
                    <span className="bc-filter-label">Eventos</span>
                  </div>
                  <div className="bc-filter-tag-row">
                    <input
                      className="bc-filter-tag-input"
                      type="text"
                      placeholder="Escribe un evento y presiona Enter..."
                      value={inputEvento}
                      onChange={(e) => setInputEvento(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter')
                          agregarTag(
                            inputEvento,
                            eventos,
                            setEventos,
                            setInputEvento,
                          )
                      }}
                    />
                  </div>
                  {eventos.length > 0 && (
                    <div className="bc-filter-chips">
                      {eventos.map((ev) => (
                        <button
                          key={ev}
                          className="bc-filter-chip selected"
                          onClick={() => quitarTag(ev, eventos, setEventos)}
                        >
                          {ev}
                          <X size={10} />
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* ── Limpiar todo ── */}
                {hayFiltrosActivos && (
                  <>
                    <div className="bc-filter-divider" />
                    <button
                      className="bc-filter-clear-all"
                      onClick={() => {
                        setPersonas([])
                        setEventos([])
                        setFechaDesde('')
                        setFechaHasta('')
                      }}
                    >
                      <X size={11} />
                      Limpiar filtros
                    </button>
                  </>
                )}
              </div>
            )}
          </div>

          <div className="bc-results-area">
            {!buscando ? (
              <div className="bc-empty">
                <div className="bc-empty-icon">
                  <Search size={26} />
                </div>
                <p className="bc-empty-title">Busca en tu colección</p>
                <p className="bc-empty-sub">
                  Escribe un término y presiona Enter para encontrar extractos
                  relevantes en todos tus documentos.
                </p>
              </div>
            ) : resultados.length === 0 ? (
              <div className="bc-empty">
                <div className="bc-empty-icon">
                  <FileText size={26} />
                </div>
                <p className="bc-empty-title">Sin resultados</p>
                <p className="bc-empty-sub">
                  No se encontraron coincidencias para{' '}
                  <strong>"{busquedaEnviada}"</strong>.
                </p>
              </div>
            ) : (
              <>
                <p className="bc-results-count">
                  {resultados.length} resultado
                  {resultados.length !== 1 ? 's' : ''} para{' '}
                  <strong>"{busquedaEnviada}"</strong>
                  {hayFiltrosActivos && (
                    <span className="bc-results-filtered">
                      {' '}· filtros aplicados
                    </span>
                  )}
                </p>
                <div className="bc-results-list">
                  {resultados.map((r, i) => (
                    <article
                      key={r.id}
                      className="bc-result-card"
                      style={{ animationDelay: `${i * 55}ms` }}
                    >
                      <div className="bc-result-source">
                        <div className="bc-result-source-icon">
                          <FileText size={12} />
                        </div>
                        <span className="bc-result-source-name">
                          {r.fuenteTitulo}
                        </span>
                        <span className="bc-result-badge">{r.fuenteTipo}</span>
                        {r.pagina && (
                          <span className="bc-result-page">
                            pág. {r.pagina}
                          </span>
                        )}
                      </div>
                      <p className="bc-result-excerpt">
                        <Highlight text={r.extracto} query={busquedaEnviada} />
                      </p>
                    </article>
                  ))}
                </div>
              </>
            )}
          </div>
        </main>
      </div>
      <ModalNoDisponible
        isOpen={modalGrafoOpen}
        onClose={() => setModalGrafoOpen(false)}
      />
    </>
  )
}

export default BuscadorColeccion