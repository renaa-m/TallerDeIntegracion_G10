import { useEffect, useState, useMemo, useCallback } from 'react'
import { useParams } from 'react-router-dom'
import CytoscapeComponent from 'react-cytoscapejs'
import cytoscape from 'cytoscape'
import { Loader2, ZoomIn, ZoomOut, RefreshCw, X } from 'lucide-react'
import { useAuth0 } from '@auth0/auth0-react'
import './visualizador_grafo.css'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8080'

// ── Tipos alineados con el backend ────────────────────────────────────────────
interface CytoscapeElement {
  data: Record<string, any>
}

interface GraphResponse {
  elements: {
    nodes: CytoscapeElement[]
    edges: CytoscapeElement[]
  }
}

// ── Componente ────────────────────────────────────────────────────────────────
const GraphViewer = () => {
  const { id_coleccion } = useParams<{ id_usuario: string; id_coleccion: string }>()
  const { getAccessTokenSilently } = useAuth0()

  const [elements, setElements] = useState<cytoscape.ElementDefinition[]>([])
  const [loading, setLoading] = useState(true)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [cyRef, setCyRef] = useState<cytoscape.Core | null>(null)
  const [selectedNode, setSelectedNode] = useState<Record<string, any> | null>(null)

  const darkMode = useMemo(
    () => document.documentElement.classList.contains('dark'),
    []
  )

  // ── Carga del grafo ──────────────────────────────────────────────────────────
  const fetchGraph = useCallback(async () => {
    if (!id_coleccion) return
    setLoading(true)
    setErrorMsg(null)

    try {
      const token = await getAccessTokenSilently()
      const res = await fetch(`${API_URL}/api/collections/${id_coleccion}/graph`, {
        headers: { Authorization: `Bearer ${token}` },
      })

      if (!res.ok) {
        const data = await res.json().catch(() => null)
        throw new Error(data?.detail || `Error ${res.status}`)
      }

      const data: GraphResponse = await res.json()

      // Convierte al formato plano que espera CytoscapeComponent
      const nodes: cytoscape.ElementDefinition[] = (data.elements?.nodes ?? []).map(n => ({
        data: { ...n.data },
      }))
      const edges: cytoscape.ElementDefinition[] = (data.elements?.edges ?? []).map(e => ({
        data: { ...e.data },
      }))

      setElements([...nodes, ...edges])
    } catch (err: any) {
      console.error('Error cargando el grafo:', err)
      setErrorMsg(err.message || 'Error desconocido al cargar el grafo.')
      setElements([])
    } finally {
      setLoading(false)
    }
  }, [id_coleccion, getAccessTokenSilently])

  useEffect(() => { fetchGraph() }, [fetchGraph])

  // ── Resize + layout cuando cambian los elementos ─────────────────────────────
  useEffect(() => {
    if (!cyRef || elements.length === 0) return
    const t = setTimeout(() => {
      try {
        cyRef.resize()
        cyRef.layout({ name: 'cose', animate: true }).run()
        cyRef.fit(undefined, 50)
      } catch { /* no-op */ }
    }, 120)
    return () => clearTimeout(t)
  }, [elements, cyRef])

  // ── Listener de selección de nodo ────────────────────────────────────────────
  useEffect(() => {
    if (!cyRef) return
    const onTap = (evt: any) => {
      const data = evt.target.data()
      setSelectedNode(data)
    }
    const onTapBackground = (evt: any) => {
      if (evt.target === cyRef) setSelectedNode(null)
    }
    cyRef.on('tap', 'node', onTap)
    cyRef.on('tap', onTapBackground)
    return () => {
      cyRef.off('tap', 'node', onTap)
      cyRef.off('tap', onTapBackground)
    }
  }, [cyRef])

  // ── Stylesheet ───────────────────────────────────────────────────────────────
  const graphStylesheet = useMemo(() => [
    {
      selector: 'node',
      style: {
        'background-color': '#8b5cf6',
        'label': 'data(label)',
        'font-size': '12px',
        'color': darkMode ? '#ffffff' : '#1a202c',
        'text-valign': 'center',
        'text-halign': 'center',
        'width': '50px',
        'height': '50px',
        'overlay-padding': '6px',
        'z-index': 10,
      },
    },
    {
      selector: 'node[tipo="Persona"]',
      style: { 'background-color': '#3b82f6' },
    },
    {
      selector: 'node[tipo="Lugar"]',
      style: { 'background-color': '#10b981' },
    },
    {
      selector: 'node:selected',
      style: {
        'border-width': 4,
        'border-color': '#f59e0b',
        'overlay-opacity': 0.15,
      },
    },
    {
      selector: 'edge',
      style: {
        'width': 2,
        'line-color': darkMode ? '#4a5568' : '#cbd5e1',
        'target-arrow-color': darkMode ? '#4a5568' : '#cbd5e1',
        'target-arrow-shape': 'triangle',
        'curve-style': 'bezier',
        'label': 'data(label)',
        'font-size': '9px',
        'color': darkMode ? '#a0aec0' : '#70757a',
        'text-rotation': 'autorotate',
        'text-margin-y': -10,
      },
    },
  ], [darkMode])

  // ── Controles ────────────────────────────────────────────────────────────────
  const handleZoomIn  = () => cyRef?.zoom({ level: cyRef.zoom() + 0.2, renderedPosition: { x: cyRef.width() / 2, y: cyRef.height() / 2 } })
  const handleZoomOut = () => cyRef?.zoom({ level: Math.max(0.1, cyRef.zoom() - 0.2), renderedPosition: { x: cyRef.width() / 2, y: cyRef.height() / 2 } })
  const handleRecenter = () => {
    if (!cyRef) return
    cyRef.layout({ name: 'cose', animate: true }).run()
    cyRef.fit(undefined, 50)
  }

  // ── Guards ───────────────────────────────────────────────────────────────────
  if (!id_coleccion) {
    return <div className="gv-error">Error: No se especificó un ID de colección válido.</div>
  }

  if (loading) {
    return (
      <div className={`gv-container ${darkMode ? 'gv-dark' : ''}`}>
        <div className="gv-loading">
          <Loader2 size={32} className="gv-spin" />
          <p>Cargando grafo...</p>
        </div>
      </div>
    )
  }

  // ── Render principal ─────────────────────────────────────────────────────────
  return (
    <div className={`gv-container ${darkMode ? 'gv-dark' : ''}`}>

      {/* Toolbar */}
      <div className="gv-toolbar">
        <button onClick={handleZoomIn}   title="Acercar"><ZoomIn   size={16} /></button>
        <button onClick={handleZoomOut}  title="Alejar"><ZoomOut  size={16} /></button>
        <button onClick={handleRecenter} title="Reorganizar"><RefreshCw size={16} /></button>
      </div>

      {/* Canvas */}
      <CytoscapeComponent
        elements={elements}
        style={{
          width: '100%',
          height: '100%',
          background: darkMode ? '#0f172a' : '#f8fafc',
        }}
        stylesheet={graphStylesheet as any}
        layout={{
          name: 'cose',
          animate: true,
          fit: true,
          padding: 30,
        }}
        cy={(cy) => setCyRef(cy)}
      />

      {/* Sin datos */}
      {elements.length === 0 && !errorMsg && (
        <div className="gv-empty">
          <div className="gv-empty-card">
            <p>No se encontraron entidades para esta colección.</p>
            <button onClick={fetchGraph} className="gv-btn">Reintentar</button>
          </div>
        </div>
      )}

      {/* Error */}
      {errorMsg && (
        <div className="gv-empty">
          <div className="gv-empty-card gv-empty-error">
            <p>{errorMsg}</p>
            <button onClick={fetchGraph} className="gv-btn">Reintentar</button>
          </div>
        </div>
      )}

      {/* Panel nodo seleccionado */}
      {selectedNode && (
        <div className="gv-selected-panel">
          <div className="gv-selected-header">
            <span className="gv-selected-title">Nodo seleccionado</span>
            <button onClick={() => setSelectedNode(null)}><X size={14} /></button>
          </div>
          <div className="gv-selected-body">
            {Object.entries(selectedNode).map(([k, v]) => (
              <div key={k} className="gv-selected-row">
                <span className="gv-selected-key">{k}</span>
                <span className="gv-selected-val">{String(v)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default GraphViewer