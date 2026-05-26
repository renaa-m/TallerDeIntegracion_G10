import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  useNavigate,
  useParams,
  useSearchParams,
  useLocation,
  Outlet,
} from 'react-router-dom'
import { useAuth0 } from '@auth0/auth0-react'
import {
  Search,
  Network,
  SlidersHorizontal,
  X,
  Trash2,
  Files,
  Edit2,
  ExternalLink,
  FileText,
  CheckCircle2,
  Loader2,
} from 'lucide-react'

import { Link } from 'react-router-dom'

// Componentes
import ModalCarga from '../../components/modal_carga/modal_carga'
import ModalEliminarColeccion from '../../components/modal_eliminar_coleccion/modal_eliminar_coleccion'
import ModalDocumentosDisponibles from '../../components/modal_documentos_disponibles/modal_documentos_disponibles'

// Estilos
import './buscador_coleccion.css'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8080'

interface SearchResultItem {
  titulo: string
  fragmento: string
  id_chunk: string
  enlace: string
  score: number
  pagina?: number
}

// --- HELPER PARA HIGHLIGHT ---
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
  const { id_usuario, id_coleccion } = useParams<{
    id_usuario: string
    id_coleccion: string
  }>()
  const { getAccessTokenSilently } = useAuth0()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const location = useLocation() // 🚀 NUEVO: Monitorea la ruta activa

  // Determina si el usuario está visualizando específicamente la ruta del grafo
  const isGrafoView = useMemo(
    () => location.pathname.endsWith('/grafo'),
    [location.pathname],
  )

  // --- ESTADOS ---
  const [nombreColeccion, setNombreColeccion] = useState('Cargando...')
  const [fuentes, setFuentes] = useState([])
  const [resultados, setResultados] = useState<SearchResultItem[]>([])
  const [isEditingName, setIsEditingName] = useState(false)
  const [tempNombre, setTempNombre] = useState('')
  const [loading, setLoading] = useState(false)
  const [searchTime, setSearchTime] = useState<number>(0) // <-- NUEVO ESTADO

  const queryFromUrl = searchParams.get('q') ?? ''
  const [busqueda, setBusqueda] = useState(queryFromUrl)
  const [busquedaEnviada, setBusquedaEnviada] = useState(queryFromUrl)

  // Modales
  const [modalCargaOpen, setModalCargaOpen] = useState(id_coleccion === 'nueva')
  const [isEliminarModalOpen, setIsEliminarModalOpen] = useState(false)
  const [isModalFuentesOpen, setIsModalFuentesOpen] = useState(false)

  // Filtros
  const [filtroOpen, setFiltroOpen] = useState(false)
  const [personas] = useState<string[]>([])
  const [fechaDesde] = useState('')
  const [fechaHasta] = useState('')

  const darkMode = window.matchMedia('(prefers-color-scheme: dark)').matches

  // --- CARGA DE DATOS INICIALES ---
  const cargarDatos = useCallback(async () => {
    if (!id_coleccion || id_coleccion === 'nueva') return

    try {
      const token = await getAccessTokenSilently()
      const headers = { Authorization: `Bearer ${token}` }

      const resColl = await fetch(
        `${API_URL}/api/collections/${id_coleccion}`,
        { headers },
      )
      if (resColl.ok) {
        const data = await resColl.json()
        setNombreColeccion(data.name)
        setTempNombre(data.name)
      }

      const resDocs = await fetch(
        `${API_URL}/api/documentos?coleccion_id=${id_coleccion}`,
        { headers },
      )
      if (resDocs.ok) {
        setFuentes(await resDocs.json())
      }
    } catch (e) {
      console.error('Error cargando datos:', e)
    }
  }, [id_coleccion, getAccessTokenSilently])

  // --- LÓGICA DE BÚSQUEDA SEMÁNTICA (POST) ---
  const ejecutarBusqueda = useCallback(async () => {
    // Si estamos en modo grafo, no ejecutamos consultas semánticas de texto innecesarias
    if (
      !id_coleccion ||
      id_coleccion === 'nueva' ||
      !busquedaEnviada.trim() ||
      isGrafoView
    ) {
      if (!isGrafoView) setResultados([])
      return
    }

    setLoading(true)
    try {
      const token = await getAccessTokenSilently()

      const searchRequest = {
        coleccion_id: id_coleccion,
        query: busquedaEnviada,
        limit: 10,
        min_score: 0.25,
        filtros:
          personas.length > 0 || fechaDesde || fechaHasta
            ? {
                tipo_entidad: personas.length > 0 ? personas[0] : null,
                rango_años:
                  fechaDesde || fechaHasta
                    ? [parseInt(fechaDesde) || 0, parseInt(fechaHasta) || 2026]
                    : null,
              }
            : null,
      }

      const startTime = performance.now() // <-- CAPTURAR TIEMPO INICIAL

      const res = await fetch(`${API_URL}/api/search`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(searchRequest),
      })

      const endTime = performance.now() // <-- CAPTURAR TIEMPO FINAL
      const durationSeconds = parseFloat(
        ((endTime - startTime) / 1000).toFixed(2),
      )

      if (res.ok) {
        const data = await res.json()
        setResultados(data.resultados || [])
        setSearchTime(durationSeconds) // <-- GUARDAR DURACIÓN EN SEGUNDOS
      } else if (res.status === 422) {
        setResultados([])
        setSearchTime(0)
      }
    } catch (e) {
      console.error('Error en búsqueda semántica:', e)
      setSearchTime(0)
    } finally {
      setLoading(false)
    }
  }, [
    id_coleccion,
    busquedaEnviada,
    personas,
    fechaDesde,
    fechaHasta,
    isGrafoView,
    getAccessTokenSilently,
  ])

  // --- EFECTOS ---
  useEffect(() => {
    const iniciarCarga = async () => {
      await cargarDatos()
    }

    void iniciarCarga()
  }, [cargarDatos])

  useEffect(() => {
    const timer = setTimeout(() => {
      ejecutarBusqueda()
    }, 400)
    return () => clearTimeout(timer)
  }, [ejecutarBusqueda])

  // --- HANDLERS ---
  const handleBuscar = () => {
    const trimmed = busqueda.trim()
    setSearchParams(trimmed ? { q: trimmed } : {})
    setBusquedaEnviada(trimmed)
  }

  const saveNombre = async () => {
    if (tempNombre.trim() && id_coleccion && id_coleccion !== 'nueva') {
      try {
        const token = await getAccessTokenSilently()
        const res = await fetch(`${API_URL}/api/collections/${id_coleccion}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ name: tempNombre }),
        })
        if (res.ok) setNombreColeccion(tempNombre)
      } catch (e) {
        console.error(e)
      }
    }
    setIsEditingName(false)
  }

  const handleDelete = async () => {
    if (!id_coleccion || id_coleccion === 'nueva') return
    try {
      const token = await getAccessTokenSilently()
      const res = await fetch(`${API_URL}/api/collections/${id_coleccion}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) navigate(`/${id_usuario}/dashboard`)
    } catch (e) {
      console.error(e)
    }
  }

  const hayFiltrosActivos = personas.length > 0 || !!fechaDesde || !!fechaHasta

  return (
    <>
      <div className={`bc-root${darkMode ? ' bc-dark' : ''}`}>
        <aside className="bc-sidebar">
          <div className="bc-sidebar-inner">
            <div className="bc-sidebar-header">
              {isEditingName ? (
                <input
                  className="bc-sidebar-name-input"
                  value={tempNombre}
                  onChange={(e) => setTempNombre(e.target.value)}
                  onBlur={saveNombre}
                  onKeyDown={(e) => e.key === 'Enter' && saveNombre()}
                  autoFocus
                />
              ) : (
                <div
                  className="bc-sidebar-title-group"
                  onClick={() => setIsEditingName(true)}
                >
                  <h2 className="bc-sidebar-collection-name">
                    {nombreColeccion}
                  </h2>
                  <Edit2 size={12} className="bc-edit-icon" />
                </div>
              )}
              <span className="bc-sidebar-collection-label">
                Colección actual
              </span>
            </div>

            <div className="bc-sidebar-divider" />

            {/* 🔄 MODIFICACIÓN DE NAVEGACIÓN: Alterna inteligentemente entre vista de Texto y vista de Grafo */}
            {isGrafoView ? (
              <Link
                to={`/${id_usuario}/colecciones/${id_coleccion}/buscador`}
                className="bc-add-btn"
                style={{
                  textDecoration: 'none',
                  display: 'inline-flex',
                  alignItems: 'center',
                }}
              >
                <FileText size={15} />{' '}
                <span style={{ marginLeft: '4px' }}>Consultar Documentos</span>
              </Link>
            ) : (
              <Link
                to={`/${id_usuario}/colecciones/${id_coleccion}/grafo`}
                className="bc-add-btn"
                style={{
                  textDecoration: 'none',
                  display: 'inline-flex',
                  alignItems: 'center',
                }}
              >
                <Network size={15} />{' '}
                <span style={{ marginLeft: '4px' }}>Ver Grafo</span>
              </Link>
            )}

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
          </div>
        </aside>

        <main className="bc-main">
          {/* 🚀 RENDERING CONDICIONAL CRÍTICO: Si la URL pide el grafo, renderiza la sub-ruta usando Outlet, sino muestra el buscador de texto tradicional */}
          {isGrafoView ? (
            <div
              style={{ width: '100%', height: '100%', position: 'relative' }}
            >
              <Outlet />
            </div>
          ) : (
            <>
              <div className="bc-searchbar-wrap">
                <div className="bc-searchbar">
                  <Search size={17} className="bc-searchbar-icon" />
                  <input
                    className="bc-searchbar-input"
                    placeholder="Consulta algo a tus documentos..."
                    value={busqueda}
                    onChange={(e) => setBusqueda(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleBuscar()}
                  />
                  <button
                    className={`bc-filter-btn ${filtroOpen ? 'active' : ''} ${hayFiltrosActivos ? 'has-filters' : ''}`}
                    onClick={() => setFiltroOpen(!filtroOpen)}
                  >
                    <SlidersHorizontal size={14} />{' '}
                    <span>Criterios de Búsqueda</span>
                  </button>
                </div>

                {filtroOpen && (
                  <div className="bc-alert-banner">
                    <div className="bc-alert-content">
                      <div className="bc-alert-icon-wrap">
                        <SlidersHorizontal
                          size={14}
                          className="bc-alert-icon"
                        />
                      </div>
                      <div className="bc-alert-text">
                        <span className="bc-alert-title">
                          Próximamente: Criterios de Búsqueda
                        </span>
                      </div>
                    </div>
                    <button
                      className="bc-alert-close"
                      onClick={() => setFiltroOpen(false)}
                    >
                      <X size={14} />
                    </button>
                  </div>
                )}
              </div>

              <div className="bc-results-area">
                {loading ? (
                  <div className="bc-empty">
                    <Loader2 className="bc-spin" size={30} />
                    <p>Consultando el grafo de conocimiento...</p>
                  </div>
                ) : resultados.length > 0 ? (
                  <>
                    <div className="bc-results-meta">
                      <span className="bc-results-count">
                        {resultados.length} resultado
                        {resultados.length !== 1 ? 's' : ''} en{' '}
                        {searchTime > 0 ? `${searchTime}s` : ''}
                      </span>
                    </div>
                    <div className="bc-results-list">
                      {resultados.map((r, idx) => (
                        <article key={idx} className="bc-result-card">
                          <div className="bc-card-header">
                            <div className="bc-header-info">
                              <div className="bc-title-row">
                                <FileText size={14} className="bc-doc-icon" />
                                <h3 className="bc-result-title">{r.titulo}</h3>
                              </div>

                              <div
                                className={`bc-score-status ${r.score > 0.7 ? 'status-high' : r.score > 0.4 ? 'status-med' : 'status-low'}`}
                              >
                                <CheckCircle2
                                  size={12}
                                  className="bc-status-icon"
                                />
                                <span className="bc-score-value">
                                  {(r.score * 100).toFixed(0)}% de coincidencia
                                </span>
                              </div>
                            </div>

                            {r.enlace && (
                              <a
                                href={r.enlace}
                                target="_blank"
                                rel="noreferrer"
                                className="bc-external-btn"
                              >
                                <ExternalLink size={13} />
                                <span>Documento</span>
                              </a>
                            )}
                          </div>

                          <div className="bc-card-body">
                            <p className="bc-result-excerpt">
                              <Highlight
                                text={r.fragmento}
                                query={busquedaEnviada}
                              />
                            </p>
                          </div>

                          <div className="bc-card-footer">
                            <div className="bc-footer-tag">
                              <Network size={12} />
                              <span>Grafo IMFD</span>
                            </div>
                            {r.pagina && (
                              <div className="bc-footer-tag">
                                <span>Página {r.pagina}</span>
                              </div>
                            )}
                          </div>
                        </article>
                      ))}
                    </div>
                  </>
                ) : (
                  <div className="bc-empty">
                    <div className="bc-empty-icon">
                      <Search size={30} />
                    </div>
                    <h3 className="bc-empty-title">Sin resultados todavía</h3>
                    <p className="bc-empty-sub">
                      {busquedaEnviada
                        ? 'No hay fragmentos que coincidan con tu búsqueda semántica.'
                        : 'Haz una consulta para explorar los documentos de esta colección.'}
                    </p>
                  </div>
                )}
              </div>
            </>
          )}
        </main>
      </div>

      <ModalCarga
        isOpen={modalCargaOpen}
        onClose={() => setModalCargaOpen(false)}
        onUploadSuccess={cargarDatos}
        darkMode={darkMode}
      />

      <ModalEliminarColeccion
        isOpen={isEliminarModalOpen}
        onClose={() => setIsEliminarModalOpen(false)}
        onConfirm={handleDelete}
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
