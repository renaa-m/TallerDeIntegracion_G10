import { useEffect, useState, useMemo, useCallback, useRef } from 'react'
import { useParams } from 'react-router-dom'
import CytoscapeComponent from 'react-cytoscapejs'
import cytoscape, {
  type Core,
  type ElementDefinition,
  type StylesheetStyle,
  type LayoutOptions,
} from 'cytoscape'
import {
  Loader2,
  ZoomIn,
  ZoomOut,
  RefreshCw,
  X,
  AlertCircle,
} from 'lucide-react'
import { useAuth0 } from '@auth0/auth0-react'
import {
  getGraphUnavailableView,
  type GraphUnavailableView,
} from '../../lib/collection_processing'
import './visualizador_grafo.css'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8080'

interface CytoscapeElement {
  data: Record<string, unknown>
}

interface GraphResponse {
  ready: boolean
  processing_status?: string
  message?: string | null
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
  const [error, setError] = useState<string | null>(null)
  const [unavailable, setUnavailable] = useState<GraphUnavailableView | null>(
    null,
  )
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

  const runLayout = useCallback((cyInstance: Core | null) => {
    if (!cyInstance) return
    const layoutOptions: LayoutOptions = {
      name: 'cose',
      animate: true,
      animationDuration: 500,
      fit: true,
      padding: 50,
      componentSpacing: 180,
    }
    cyInstance.layout(layoutOptions).run()
  }, [])

  useEffect(() => {
    if (cyRef && elements.length > 0) {
      runLayout(cyRef)
    }
  }, [cyRef, elements, runLayout])

  const fetchGraph = useCallback(async (options?: { silent?: boolean }) => {
    if (!id_coleccion || id_coleccion === 'nueva') return
    if (!options?.silent) {
      setLoading(true)
      setError(null)
      setUnavailable(null)
    }
    try {
      const token = await getAccessTokenSilently()
      const headers = { Authorization: `Bearer ${token}` }
      const res = await fetch(
        `${API_URL}/api/collections/${id_coleccion}/graph`,
        { headers },
      )

      if (res.status === 404) {
        setUnavailable({
          title: 'Colección no encontrada',
          subtitle:
            'Esta colección ya no existe. Vuelve al inicio e intenta con otra.',
          pending: false,
        })
        return
      }

      if (!res.ok) {
        let detail = `Error al cargar el grafo (${res.status})`
        try {
          const body = await res.json()
          if (body?.detail) detail = String(body.detail)
        } catch {
          /* respuesta no JSON */
        }
        throw new Error(detail)
      }

      const data: GraphResponse = await res.json()

      if (!data.ready) {
        setUnavailable(
          getGraphUnavailableView(data.processing_status ?? null),
        )
        return
      }

      if (
        !data.elements ||
        (data.elements.nodes.length === 0 && data.elements.edges.length === 0)
      ) {
        setUnavailable(getGraphUnavailableView('idle'))
        return
      }

      const nodes: ElementDefinition[] = data.elements.nodes.map((n) => ({
        data: { ...n.data, id: String(n.data.id) },
      }))

      const edges: ElementDefinition[] = data.elements.edges.map(
        (e, index) => ({
          data: {
            ...e.data,
            id: e.data.id ? String(e.data.id) : `edge-${index}-${Date.now()}`,
            source: String(e.data.source ?? e.data.from),
            target: String(e.data.target ?? e.data.to),
            label: e.data.label || '',
          },
        }),
      )

      setElements([...nodes, ...edges])
    } catch (err) {
      console.error('Error fetching graph:', err)
      setError(err instanceof Error ? err.message : 'Error desconocido')
    } finally {
      if (!options?.silent) {
        setLoading(false)
      }
    }
  }, [id_coleccion, getAccessTokenSilently])

  // Actualizar automáticamente mientras el grafo se genera (solo /graph, sin GET extra).
  useEffect(() => {
    if (!unavailable?.pending) return
    const interval = window.setInterval(() => {
      void fetchGraph({ silent: true })
    }, 5000)
    return () => clearInterval(interval)
  }, [unavailable?.pending, fetchGraph])

  // Fix para el Linter: Usar bandera de montaje y función interna
  useEffect(() => {
    let isMounted = true

    const init = async () => {
      await fetchGraph()
    }

    if (isMounted) {
      init()
    }

    return () => {
      isMounted = false
    }
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
          'curve-style': 'bezier',
          label: 'data(label)',
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
      <div className="gv-outer-wrapper gv-loading-container">
        <Loader2 className="gv-spin-loader animate-spin" size={48} />
        <p>Cargando grafo...</p>
      </div>
    )

  if (unavailable || error)
    return (
      <div
        className={`gv-outer-wrapper gv-error-container${unavailable?.pending ? ' gv-unavailable-pending' : unavailable ? ' gv-unavailable-info' : ''}`}
      >
        {unavailable?.pending ? (
          <Loader2 size={48} className="gv-spin-loader animate-spin" />
        ) : (
          <AlertCircle
            size={48}
            className={unavailable ? 'gv-unavailable-icon' : 'text-red-500'}
          />
        )}
        {unavailable ? (
          <>
            <h2 className="gv-unavailable-title">{unavailable.title}</h2>
            <p className="gv-unavailable-subtitle">{unavailable.subtitle}</p>
          </>
        ) : (
          <p>{error}</p>
        )}
        <button
          onClick={() => void fetchGraph()}
          className="gv-retry-button"
        >
          {unavailable?.pending ? 'Comprobar de nuevo' : 'Reintentar'}
        </button>
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
