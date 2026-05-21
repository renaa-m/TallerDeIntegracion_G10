import { useEffect, useState } from 'react'
import CytoscapeComponent from 'react-cytoscapejs'
import cytoscape from 'cytoscape'
import { Loader2, ZoomIn, ZoomOut, RefreshCw } from 'lucide-react'
import { useAuth0 } from '@auth0/auth0-react'
import './graph_viewer.css'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8080'

interface GraphViewerProps {
  coleccionId: string
  darkMode: boolean
}

const GraphViewer = ({ coleccionId, darkMode }: GraphViewerProps) => {
  const [elements, setElements] = useState([])
  const [loading, setLoading] = useState(true)
  const [cyRef, setCyRef] = useState<cytoscape.Core | null>(null)
  const { getAccessTokenSilently } = useAuth0()

  useEffect(() => {
    const fetchGraphData = async () => {
      setLoading(true)
      try {
        const token = await getAccessTokenSilently()
        const res = await fetch(`${API_URL}/api/grafo/${coleccionId}`, {
          headers: { Authorization: `Bearer ${token}` }
        })
        if (res.ok) {
          const data = await res.json()
          setElements(data.elements)
        }
      } catch (error) {
        console.error("Error cargando el grafo:", error)
      } finally {
        setLoading(false)
      }
    }
    if (coleccionId) fetchGraphData()
  }, [coleccionId, getAccessTokenSilently])

// Cambiamos el tipo a any[] temporalmente para evitar que el wrapper reclame por su interfaz interna custom
  const graphStylesheet: any[] = [
    {
      selector: 'node',
      style: {
        'background-color': ((node: cytoscape.NodeSingular) => {
          const tipo = node.data('tipo')
          if (tipo === 'Persona') return '#3b82f6'
          if (tipo === 'Lugar') return '#10b981'
          return '#8b5cf6'
        }) as any,
        'label': 'data(label)',
        'font-size': '12px',
        'color': darkMode ? '#ffffff' : '#1a202c',
        'text-valign': 'center',
        'text-halign': 'center',
        'width': '50px',
        'height': '50px',
        'overlay-padding': '6px',
        'z-index': 10
      }
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
        'text-margin-y': -10
      }
    }
  ]

  // Controles del Canvas
  const handleRecenter = () => {
    if (cyRef) {
      cyRef.layout({ name: 'cose', animate: true }).run()
      cyRef.fit()
    }
  }

  if (loading) {
    return (
      <div className="gv-loading">
        <Loader2 className="bc-spin" size={40} />
        <p>Renderizando relaciones y entidades del IMFD...</p>
      </div>
    )
  }

  return (
    <div className={`gv-container ${darkMode ? 'gv-dark' : ''}`}>
      {/* Barra de herramientas flotante */}
      <div className="gv-toolbar">
        <button onClick={() => cyRef?.zoom(cyRef.zoom() + 0.1)} title="Acercar"><ZoomIn size={16} /></button>
        <button onClick={() => cyRef?.zoom(cyRef.zoom() - 0.1)} title="Alejar"><ZoomOut size={16} /></button>
        <button onClick={handleRecenter} title="Reorganizar Grafo"><RefreshCw size={16} /></button>
      </div>

      <CytoscapeComponent
        elements={elements}
        style={{ width: '100%', height: '100%' }}
        stylesheet={graphStylesheet as any} // <-- LE AGREGAMOS EL "as any" AQUÍ
        layout={{
          name: 'cose',
          idealEdgeLength: 100,
          nodeOverlap: 20,
          refresh: 20,
          fit: true,
          padding: 30
        }}
        cy={(cy) => setCyRef(cy)}
      />

    </div>
  )
}

export default GraphViewer