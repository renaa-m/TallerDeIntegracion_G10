import { useEffect, useState, useMemo, useCallback, useRef } from 'react'
import { useParams } from 'react-router-dom'
import CytoscapeComponent from 'react-cytoscapejs'
import cytoscape from 'cytoscape'
import { Loader2, ZoomIn, ZoomOut, RefreshCw, X, Info } from 'lucide-react'
import { useAuth0 } from '@auth0/auth0-react'
import './visualizador_grafo.css'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8080'

interface CytoscapeElement {
  data: Record<string, any>
}

interface GraphResponse {
  elements: {
    nodes: CytoscapeElement[]
    edges: CytoscapeElement[]
  }
}

const GraphViewer = () => {
  const { id_coleccion } = useParams<{
    id_usuario: string
    id_coleccion: string
  }>()
  const { getAccessTokenSilently } = useAuth0()

  const [elements, setElements] = useState<cytoscape.ElementDefinition[]>([])
  const [loading, setLoading] = useState(true)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [cyRef, setCyRef] = useState<cytoscape.Core | null>(null)
  const [selectedData, setSelectedData] = useState<Record<string, any> | null>(
    null,
  )
  const [selectedType, setSelectedType] = useState<'node' | 'edge' | null>(null)

  const containerRef = useRef<HTMLDivElement>(null)

  const darkMode = useMemo(
    () => document.documentElement.classList.contains('dark'),
    [],
  )

  // ── Función de Renderizado y Física Forzada ──────────────────────────────────
  const runLayout = useCallback(
    (cyInstance: cytoscape.Core | null) => {
      if (!cyInstance || elements.length === 0) return

      try {
        // Forzamos al motor gráfico a recalcular el espacio físico real disponible
        cyInstance.resize()
        cyInstance.invalidateDimensions()

        const layout = cyInstance.layout({
          name: 'cose',
          animate: true,
          animationDuration: 500,
          fit: true,
          padding: 50,
          componentSpacing: 180, // Separación amplia para estirar las aristas
          nodeOverlap: 80,
          idealEdgeLength: () => 140, // Forzar longitud de arista larga para visibilidad masiva
          refresh: 20,
        })

        layout.run()

        setTimeout(() => {
          cyInstance.fit(undefined, 50)
          cyInstance.center()
          cyInstance.forceRender() // 🔥 CORREGIDO: Redibuja el buffer completo del canvas
        }, 550)
      } catch (err) {
        console.error('Error en el motor de fuerzas:', err)
      }
    },
    [elements],
  )

  // ── Carga de Datos y Limpieza Preventiva ─────────────────────────────────────
  const fetchGraph = useCallback(async () => {
    if (!id_coleccion) return
    setLoading(true)
    setErrorMsg(null)

    try {
      const token = await getAccessTokenSilently()
      const res = await fetch(
        `${API_URL}/api/collections/${id_coleccion}/graph`,
        {
          headers: { Authorization: `Bearer ${token}` },
        },
      )

      if (!res.ok) {
        const data = await res.json().catch(() => null)
        throw new Error(data?.detail || `Error ${res.status}`)
      }

      const data: GraphResponse = await res.json()

      const nodes: cytoscape.ElementDefinition[] = (
        data.elements?.nodes ?? []
      ).map((n) => ({
        data: { ...n.data, id: String(n.data.id) },
      }))

      const edges: cytoscape.ElementDefinition[] = (
        data.elements?.edges ?? []
      ).map((e, index) => {
        const rawData = e.data || {}
        const sourceId =
          rawData.source ||
          rawData.source_id ||
          rawData.id_origen ||
          rawData.from
        const targetId =
          rawData.target ||
          rawData.target_id ||
          rawData.id_destino ||
          rawData.to

        return {
          data: {
            ...rawData,
            id: rawData.id ? String(rawData.id) : `edge-${index}-${Date.now()}`,
            source: String(sourceId),
            target: String(targetId),
          },
        }
      })

      setElements([...nodes, ...edges])
    } catch (err: any) {
      console.error('Error cargando grafo:', err)
      setErrorMsg(err.message || 'Error al conectar con el servidor.')
    } finally {
      setLoading(false)
    }
  }, [id_coleccion, getAccessTokenSilently])

  useEffect(() => {
    fetchGraph()
  }, [fetchGraph])

  // ── Ciclo de Vida del Contenedor con Garantía de Renderizado ─────────────────
  useEffect(() => {
    if (!cyRef || !containerRef.current || elements.length === 0) return

    const resizeObserver = new ResizeObserver(() => {
      cyRef.resize()
      cyRef.invalidateDimensions()
      cyRef.forceRender() // 🔥 CORREGIDO: Redibuja dinámicamente si el componente cambia de tamaño
    })

    resizeObserver.observe(containerRef.current)

    const timer = setTimeout(() => {
      runLayout(cyRef)
    }, 400)

    return () => {
      resizeObserver.disconnect()
      clearTimeout(timer)
    }
  }, [cyRef, elements, runLayout])

  // ── Listeners de Selección ──────────────────────────────────────────────────
  useEffect(() => {
    if (!cyRef) return

    const handleSelect = (evt: any, type: 'node' | 'edge') => {
      setSelectedData(evt.target.data())
      setSelectedType(type)
    }

    const handleUnselect = (evt: any) => {
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

  // ── Stylesheet ultra-visible (Cambio a curvas seguras) ───────────────────────
  const graphStylesheet = useMemo(
    () => [
      {
        selector: 'node',
        style: {
          'background-color': '#8b5cf6',
          label: 'data(label)',
          'font-size': '12px',
          'font-family': '"DM Sans", sans-serif',
          'font-weight': 'bold',
          color: darkMode ? '#e2e8f0' : '#1e293b',
          'text-valign': 'bottom',
          'text-halign': 'center',
          'text-margin-y': 8,
          width: '45px',
          height: '45px',
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
          width: 4, // Grosor optimizado de alta visibilidad
          'line-color': darkMode ? '#94a3b8' : '#64748b',
          'target-arrow-color': darkMode ? '#94a3b8' : '#64748b',
          'target-arrow-shape': 'triangle',
          'curve-style': 'straight', // Líneas rectas forzadas para evitar colapso de vectores bezier
          label: 'data(label)',
          'font-size': '10px',
          'font-family': '"DM Sans", sans-serif',
          color: darkMode ? '#cbd5e1' : '#334155',
          'text-rotation': 'autorotate',
          'text-margin-y': -10,
          'z-index': 1,
          opacity: 0.85,
        },
      },
      {
        selector: 'edge:selected',
        style: {
          width: 6,
          'line-color': '#f59e0b',
          'target-arrow-color': '#f59e0b',
          'z-index': 5,
        },
      },
    ],
    [darkMode],
  )

  const handleZoomIn = () =>
    cyRef?.zoom({
      level: cyRef.zoom() + 0.2,
      renderedPosition: { x: cyRef.width() / 2, y: cyRef.height() / 2 },
    })

  const handleZoomOut = () =>
    cyRef?.zoom({
      level: Math.max(0.1, cyRef.zoom() - 0.2),
      renderedPosition: { x: cyRef.width() / 2, y: cyRef.height() / 2 },
    })

  const handleRecenter = () => runLayout(cyRef)

  const filteredMetadata = useMemo(() => {
    if (!selectedData) return []
    const blacklist = ['id', 'source', 'target', 'label', 'tipo']
    return Object.entries(selectedData).filter(
      ([key]) => !blacklist.includes(key),
    )
  }, [selectedData])

  if (!id_coleccion) {
    return <div className="gv-error">Error: ID de colección inválido.</div>
  }

  if (loading) {
    return (
      <div className="gv-outer-wrapper gv-loading-box">
        <Loader2 size={32} className="gv-spin-loader" />
        <p>Mapeando relaciones estructuradas...</p>
      </div>
    )
  }

  return (
    <div ref={containerRef} className="gv-outer-wrapper">
      {/* Barra de Herramientas Flotante */}
      <div className="gv-floating-toolbar">
        <button onClick={handleZoomIn} title="Acercar">
          <ZoomIn size={16} />
        </button>
        <button onClick={handleZoomOut} title="Alejar">
          <ZoomOut size={16} />
        </button>
        <button onClick={handleRecenter} title="Reorganizar Grafo">
          <RefreshCw size={16} />
        </button>
      </div>

      {/* Contenedor del Lienzo de Cytoscape */}
      <div className="gv-canvas-viewport">
        <CytoscapeComponent
          elements={elements}
          style={{ width: '100%', height: '100%', display: 'block' }}
          stylesheet={graphStylesheet as any}
          layout={{ name: 'preset' }}
          cy={(cy) => setCyRef(cy)}
        />
      </div>

      {/* Estados Vacíos o Errores */}
      {elements.length === 0 && !errorMsg && (
        <div className="gv-overlay-card">
          <div className="gv-card-info">
            <p>Colección vacía.</p>
          </div>
        </div>
      )}
      {errorMsg && (
        <div className="gv-overlay-card">
          <div className="gv-card-info gv-card-error">
            <p>{errorMsg}</p>
          </div>
        </div>
      )}

      {/* Panel Lateral de Inspección Semántica */}
      {selectedData && (
        <div className="gv-inspector-panel">
          <div className="gv-inspector-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Info size={15} style={{ color: '#f59e0b' }} />
              <span className="gv-inspector-title">
                {selectedType === 'node'
                  ? 'Detalle Entidad'
                  : 'Detalle Relación'}
              </span>
            </div>
            <button
              className="gv-inspector-close"
              onClick={() => {
                cyRef?.elements().unselect()
                setSelectedData(null)
                setSelectedType(null)
              }}
            >
              <X size={15} />
            </button>
          </div>
          <div className="gv-inspector-body">
            <div className="gv-badge-container">
              <span className="gv-type-badge">
                {selectedType === 'node'
                  ? `Tipo: ${selectedData.tipo || 'General'}`
                  : 'Predicado'}
              </span>
              <p className="gv-main-label-display">
                {selectedData.label || 'Sin etiqueta'}
              </p>
            </div>
            {filteredMetadata.length > 0 ? (
              filteredMetadata.map(([k, v]) => (
                <div key={k} className="gv-metadata-row">
                  <span className="gv-metadata-key">{k}</span>
                  <span className="gv-metadata-val">{String(v)}</span>
                </div>
              ))
            ) : (
              <p className="gv-no-metadata-text">
                No registra atributos adicionales.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default GraphViewer
