import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useAuth0 } from '@auth0/auth0-react'
import {
  Search,
  Network,
  SlidersHorizontal,
  X,
  User,
  CalendarRange,
  Trash2,
  Files,
  Edit2,
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
  const [personas, setPersonas] = useState<string[]>([])
  const [eventos, setEventos] = useState<string[]>([])
  const [fechaDesde, setFechaDesde] = useState('')
  const [fechaHasta, setFechaHasta] = useState('')

  const darkMode = window.matchMedia('(prefers-color-scheme: dark)').matches

  // --- CARGA DE DATOS ---
  const cargarDatos = useCallback(async () => {
    if (!id_coleccion || id_coleccion === 'nueva') return

    try {
      const token = await getAccessTokenSilently()
      const headers = { Authorization: `Bearer ${token}` }

      // 1. Cargar Info Colección
      const resColl = await fetch(
        `${API_URL}/api/collections/${id_coleccion}`,
        { headers },
      )
      if (resColl.ok) {
        const data = await resColl.json()
        setNombreColeccion(data.name)
        setTempNombre(data.name)
      }

      // 2. Cargar Documentos
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

  // --- LÓGICA DE BÚSQUEDA ---
  const ejecutarBusqueda = useCallback(async () => {
    // IMPORTANTE: No buscar si no hay ID o si el string está vacío (evita spam al back)
    if (!id_coleccion || id_coleccion === 'nueva' || !busquedaEnviada.trim()) {
      setResultados([])
      return
    }

    try {
      const token = await getAccessTokenSilently()
      const params = new URLSearchParams({
        q: busquedaEnviada,
        coleccion_id: id_coleccion,
        ...(personas.length && { personas: personas.join(',') }),
        ...(eventos.length && { eventos: eventos.join(',') }),
        ...(fechaDesde && { desde: fechaDesde }),
        ...(fechaHasta && { hasta: fechaHasta }),
      })

      const res = await fetch(`${API_URL}/api/search?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) {
        const data = await res.json()
        setResultados(data)
      }
    } catch (e) {
      console.error('Error en búsqueda:', e)
    }
  }, [
    id_coleccion,
    busquedaEnviada,
    personas,
    eventos,
    fechaDesde,
    fechaHasta,
    getAccessTokenSilently,
  ])

  // --- EFECTOS ---
  useEffect(() => {
    cargarDatos()
  }, [cargarDatos])

  useEffect(() => {
    // Solo disparamos la búsqueda si realmente hay algo que buscar
    const timer = setTimeout(() => {
      ejecutarBusqueda()
    }, 300) // Pequeño debounce para no saturar
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

  const hayFiltrosActivos =
    personas.length > 0 || eventos.length > 0 || !!fechaDesde || !!fechaHasta

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
                onKeyDown={(e) => e.key === 'Enter' && handleBuscar()}
              />
              <button
                className={`bc-filter-btn ${filtroOpen ? 'active' : ''} ${hayFiltrosActivos ? 'has-filters' : ''}`}
                onClick={() => setFiltroOpen(!filtroOpen)}
              >
                <SlidersHorizontal size={14} /> <span>Filtrar</span>
              </button>
            </div>

            {/* Panel de filtros (puedes mantener tu lógica de tags aquí) */}
          </div>

          <div className="bc-results-area">
            {resultados.length > 0 ? (
              <div className="bc-results-list">
                {resultados.map((r: any, idx) => (
                  <article key={idx} className="bc-result-card">
                    <div className="bc-result-source">
                      <span className="bc-result-source-name">
                        {r.fuente_nombre}
                      </span>
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
                <Search size={30} />
                <p>
                  {busquedaEnviada
                    ? 'Sin resultados para esta búsqueda'
                    : 'Escribe algo y presiona Enter para buscar'}
                </p>
              </div>
            )}
          </div>
        </main>
      </div>

      {/* Modales */}
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
