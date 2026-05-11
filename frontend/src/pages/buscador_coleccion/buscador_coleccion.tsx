import { useState, useEffect, useCallback } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useAuth0 } from '@auth0/auth0-react'
import {
  Search,
  Network,
  SlidersHorizontal,
  X,
  Trash2,
  Files,
  Edit2,
  AlertCircle,
  ExternalLink,
} from 'lucide-react'

// Componentes
import ModalNoDisponible from '../../components/modal_no_disponible/modal_no_disponible'
import ModalCarga from '../../components/modal_carga/modal_carga'
import ModalEliminarColeccion from '../../components/modal_eliminar_coleccion/modal_eliminar_coleccion'
import ModalDocumentosDisponibles from '../../components/modal_documentos_disponibles/modal_documentos_disponibles'

// Estilos
import './buscador_coleccion.css'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8080'

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

  // --- ESTADOS ---
  const [nombreColeccion, setNombreColeccion] = useState('Cargando...')
  const [fuentes, setFuentes] = useState([])
  const [resultados, setResultados] = useState([])
  const [isEditingName, setIsEditingName] = useState(false)
  const [tempNombre, setTempNombre] = useState('')
  const [loading, setLoading] = useState(false)

  const queryFromUrl = searchParams.get('q') ?? ''
  const [busqueda, setBusqueda] = useState(queryFromUrl)
  const [busquedaEnviada, setBusquedaEnviada] = useState(queryFromUrl)

  // Modales
  const [modalCargaOpen, setModalCargaOpen] = useState(id_coleccion === 'nueva')
  const [modalGrafoOpen, setModalGrafoOpen] = useState(false)
  const [isEliminarModalOpen, setIsEliminarModalOpen] = useState(false)
  const [isModalFuentesOpen, setIsModalFuentesOpen] = useState(false)

  // Filtros
  const [filtroOpen, setFiltroOpen] = useState(false)
  const [personas, setPersonas] = useState<string[]>([]) // Se usa para 'tipo_entidad' en el backend
  const [fechaDesde, setFechaDesde] = useState('')
  const [fechaHasta, setFechaHasta] = useState('')

  const darkMode = window.matchMedia('(prefers-color-scheme: dark)').matches

  // --- CARGA DE DATOS INICIALES ---
  const cargarDatos = useCallback(async () => {
    if (!id_coleccion || id_coleccion === 'nueva') return

    try {
      const token = await getAccessTokenSilently()
      const headers = { Authorization: `Bearer ${token}` }

      const resColl = await fetch(`${API_URL}/api/collections/${id_coleccion}`, { headers })
      if (resColl.ok) {
        const data = await resColl.json()
        setNombreColeccion(data.name)
        setTempNombre(data.name)
      }

      const resDocs = await fetch(`${API_URL}/api/documentos?coleccion_id=${id_coleccion}`, { headers })
      if (resDocs.ok) {
        setFuentes(await resDocs.json())
      }
    } catch (e) {
      console.error('Error cargando datos:', e)
    }
  }, [id_coleccion, getAccessTokenSilently])

  // --- LÓGICA DE BÚSQUEDA SEMÁNTICA (POST) ---
  const ejecutarBusqueda = useCallback(async () => {
    if (!id_coleccion || id_coleccion === 'nueva' || !busquedaEnviada.trim()) {
      setResultados([])
      return
    }

    setLoading(true)
    try {
      const token = await getAccessTokenSilently()
      
      // Construcción del SearchRequest para FastAPI
      const searchRequest = {
        coleccion_id: id_coleccion,
        query: busquedaEnviada,
        limit: 10,
        min_score: 0.25,
        filtros: (personas.length > 0 || fechaDesde || fechaHasta) ? {
          tipo_entidad: personas.length > 0 ? personas[0] : null,
          rango_años: (fechaDesde || fechaHasta) 
            ? [parseInt(fechaDesde) || 0, parseInt(fechaHasta) || 2026] 
            : null
        } : null
      }

      const res = await fetch(`${API_URL}/api/search`, {
        method: 'POST',
        headers: { 
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json' 
        },
        body: JSON.stringify(searchRequest),
      })

      if (res.ok) {
        const data = await res.json()
        // El backend devuelve SearchResponse con la llave "resultados"
        setResultados(data.resultados || [])
      } else if (res.status === 422) {
        // Colección no procesada aún
        setResultados([])
      }
    } catch (e) {
      console.error('Error en búsqueda semántica:', e)
    } finally {
      setLoading(false)
    }
  }, [
    id_coleccion,
    busquedaEnviada,
    personas,
    fechaDesde,
    fechaHasta,
    getAccessTokenSilently,
  ])

  // --- EFECTOS ---
  useEffect(() => {
    cargarDatos()
  }, [cargarDatos])

  useEffect(() => {
    const timer = setTimeout(() => {
      ejecutarBusqueda()
    }, 400) // Debounce ligeramente mayor para búsqueda semántica
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
                <div className="bc-sidebar-title-group" onClick={() => setIsEditingName(true)}>
                  <h2 className="bc-sidebar-collection-name">{nombreColeccion}</h2>
                  <Edit2 size={12} className="bc-edit-icon" />
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
                placeholder="Pregunta algo a tus documentos..."
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleBuscar()}
              />
              <button
                className={`bc-filter-btn ${filtroOpen ? 'active' : ''} ${hayFiltrosActivos ? 'has-filters' : ''}`}
                onClick={() => setFiltroOpen(!filtroOpen)}
              >
                <SlidersHorizontal size={14} /> <span>Filtrar</span>
              </button>
            </div>

            {filtroOpen && (
              <div className="bc-filter-panel-placeholder" style={{
                marginTop: '8px', padding: '12px', borderRadius: '8px',
                backgroundColor: darkMode ? '#2a2a2a' : '#f5f5f5',
                border: `1px dashed ${darkMode ? '#444' : '#ccc'}`,
                display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.85rem'
              }}>
                <AlertCircle size={14} />
                <span>Búsqueda semántica activa. Filtros por entidad y año próximamente.</span>
              </div>
            )}
          </div>

          <div className="bc-results-area">
            {loading ? (
              <div className="bc-empty">
                <p>Buscando en el grafo...</p>
              </div>
            ) : resultados.length > 0 ? (
              <div className="bc-results-list">
                {resultados.map((r: any, idx) => (
                  <article key={idx} className="bc-result-card">
                    <div className="bc-result-source">
                      <div className="bc-result-header-left">
                        <span className="bc-result-source-name">{r.titulo}</span>
                        <span className="bc-result-score">Similitud: {(r.score * 100).toFixed(1)}%</span>
                      </div>
                      {r.enlace && (
                        <a 
                          href={r.enlace} 
                          target="_blank" 
                          rel="noreferrer" 
                          className="bc-result-link"
                          title="Abrir documento original"
                        >
                          <ExternalLink size={14} />
                        </a>
                      )}
                    </div>
                    <p className="bc-result-excerpt">
                      <Highlight text={r.fragmento} query={busquedaEnviada} />
                    </p>
                  </article>
                ))}
              </div>
            ) : (
              <div className="bc-empty">
                <Search size={30} />
                <p>
                  {busquedaEnviada
                    ? 'No encontramos fragmentos relevantes'
                    : 'Realiza una consulta semántica para explorar la colección'}
                </p>
              </div>
            )}
          </div>
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

      <ModalNoDisponible
        isOpen={modalGrafoOpen}
        onClose={() => setModalGrafoOpen(false)}
      />
    </>
  )
}

export default BuscadorColeccion