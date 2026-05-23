import { useEffect, useState, useMemo, useCallback, useRef } from 'react'
import { useParams } from 'react-router-dom'
import CytoscapeComponent from 'react-cytoscapejs'
import cytoscape, {
  type Core,
  type ElementDefinition,
  type StylesheetStyle,
  type LayoutOptions,
} from 'cytoscape'
import { Loader2, ZoomIn, ZoomOut, RefreshCw, X } from 'lucide-react'
import { useAuth0 } from '@auth0/auth0-react'
import './visualizador_grafo.css'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8080'

interface CytoscapeElement {
  data: Record<string, unknown>
}

interface GraphResponse {
  elements: {
    nodes: CytoscapeElement[]
    edges: CytoscapeElement[]
  }
}

const GraphViewer = () => {
  const { id_coleccion } = useParams<{ id_coleccion: string }>()
  const { getAccessTokenSilently } = useAuth0()

  const [elements, setElements] = useState<ElementDefinition[]>([])
  const [loading, setLoading] = useState(true)
  const [cyRef, setCyRef] = useState<Core | null>(null)
  const [selectedData, setSelectedData] = useState<Record<
    string,
    unknown
  > | null>(null)
  const [selectedType, setSelectedType] = useState<'node' | 'edge' | null>(null)

  const containerRef = useRef<HTMLDivElement>(null)
  const darkMode = useMemo(
    () => document.documentElement.classList.contains('dark'),
    [],
  )

  const runLayout = useCallback(
    (cyInstance: Core | null) => {
      if (!cyInstance || elements.length === 0) return

      const layoutOptions: LayoutOptions = {
        name: 'cose',
        animate: true,
        animationDuration: 500,
        fit: true,
        padding: 50,
        componentSpacing: 180,
      }

      cyInstance.resize()
      cyInstance.layout(layoutOptions).run()
    },
    [elements],
  )

  const fetchGraph = useCallback(async () => {
    if (!id_coleccion) return
    setLoading(true)
    try {
      const token = await getAccessTokenSilently()
      const res = await fetch(
        `${API_URL}/api/collections/${id_coleccion}/graph`,
        {
          headers: { Authorization: `Bearer ${token}` },
        },
      )
      if (!res.ok) throw new Error(`Error ${res.status}`)

      const data: GraphResponse = await res.json()

      const nodes: ElementDefinition[] = (data.elements?.nodes ?? []).map(
        (n) => ({
          data: { ...n.data, id: String(n.data.id) },
        }),
      )

      // Aseguramos que la etiqueta (label) se mantenga en el objeto de datos de la arista
      const edges: ElementDefinition[] = (data.elements?.edges ?? []).map(
        (e, index) => ({
          data: {
            ...e.data,
            id: e.data.id ? String(e.data.id) : `edge-${index}-${Date.now()}`,
            source: String(e.data.source ?? e.data.from),
            target: String(e.data.target ?? e.data.to),
            label: e.data.label || '', // Nombre de la arista para el estilo
          },
        }),
      )

      setElements([...nodes, ...edges])
    } catch (err) {
      console.error('Error fetching graph:', err)
    } finally {
      setLoading(false)
    }
  }, [id_coleccion, getAccessTokenSilently])

  useEffect(() => {
    const loadData = async () => {
      await fetchGraph()
    }
    loadData()
  }, [fetchGraph])

  useEffect(() => {
    if (!cyRef) return
    const handleSelect = (
      evt: cytoscape.EventObject,
      type: 'node' | 'edge',
    ) => {
      setSelectedData(evt.target.data() as Record<string, unknown>)
      setSelectedType(type)
    }
    const handleUnselect = (evt: cytoscape.EventObject) => {
      if (evt.target === cyRef) {
        setSelectedData(null)
        setSelectedType(null)
      }
    }
    cyRef.on('tap', 'node', (e) => handleSelect(e, 'node'))
    cyRef.on('tap', 'edge', (e) => handleSelect(e, 'edge'))
    cyRef.on('tap', handleUnselect)
    return () => {
      cyRef.off('tap', 'node')
      cyRef.off('tap', 'edge')
      cyRef.off('tap', handleUnselect)
    }
  }, [cyRef])

  const graphStylesheet: StylesheetStyle[] = useMemo(
    () => [
      {
        selector: 'node',
        style: {
          'background-color': '#8b5cf6',
          label: 'data(label)',
          color: darkMode ? '#e2e8f0' : '#1e293b',
        } as cytoscape.Css.Node,
      },
      {
        selector: 'edge',
        style: {
          width: 4,
          'line-color': darkMode ? '#94a3b8' : '#64748b',
          'curve-style': 'bezier', // Cambiado a bezier para mejorar visualización de etiquetas
          label: 'data(label)', // Aquí vinculamos el nombre de la arista
          'font-size': '10px',
          'text-background-opacity': 1,
          'text-background-color': '#ffffff',
          'text-background-padding': '2px',
        } as cytoscape.Css.Edge,
      },
    ],
    [darkMode],
  )

  const filteredMetadata = useMemo(() => {
    if (!selectedData) return []
    const blacklist = ['id', 'source', 'target', 'label', 'tipo']
    return Object.entries(selectedData).filter(
      ([key]) => !blacklist.includes(key),
    )
  }, [selectedData])

  if (loading)
    return (
      <div className="gv-outer-wrapper">
        <Loader2 className="gv-spin-loader" />
      </div>
    )

  return (
    <div ref={containerRef} className="gv-outer-wrapper">
      <div className="gv-floating-toolbar">
        <button onClick={() => cyRef?.zoom(cyRef.zoom() + 0.2)}>
          <ZoomIn size={16} />
        </button>
        <button onClick={() => cyRef?.zoom(Math.max(0.1, cyRef.zoom() - 0.2))}>
          <ZoomOut size={16} />
        </button>
        <button onClick={() => runLayout(cyRef)}>
          <RefreshCw size={16} />
        </button>
      </div>

      <div className="gv-canvas-viewport">
        <CytoscapeComponent
          elements={elements}
          style={{ width: '100%', height: '100%' }}
          stylesheet={graphStylesheet}
          layout={{ name: 'preset' }}
          cy={(cy) => setCyRef(cy)}
        />
      </div>

      {selectedData && (
        <div className="gv-inspector-panel">
          <div className="gv-inspector-header">
            <span>{selectedType === 'node' ? 'Entidad' : 'Relación'}</span>
            <button
              onClick={() => {
                setSelectedData(null)
                cyRef?.elements().unselect()
              }}
            >
              <X size={15} />
            </button>
          </div>
          <div className="gv-inspector-body">
            <p className="gv-main-label">
              {String(selectedData.label || 'Sin etiqueta')}
            </p>
            {filteredMetadata.map(([k, v]) => (
              <div key={k} className="gv-metadata-row">
                <span className="gv-metadata-key">{k}</span>
                <span className="gv-metadata-val">{String(v)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default GraphViewer
