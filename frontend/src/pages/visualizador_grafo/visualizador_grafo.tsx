import { useEffect, useState, useMemo, useCallback, useRef } from 'react'
import { useParams } from 'react-router-dom'
import CytoscapeComponent from 'react-cytoscapejs'
import {
  type Core,
  type ElementDefinition,
  type StylesheetStyle,
  type LayoutOptions,
} from 'cytoscape'
import {
  formatDateValue,
  isProbablyDateKey,
  isProbablyDateValue,
} from '../../utils/dateFormatter'
import {
  Loader2,
  ZoomIn,
  ZoomOut,
  RefreshCw,
  X,
  AlertCircle,
} from 'lucide-react'
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

interface GraphData {
  label?: string
  source_document_id?: string | number
  source_document_name?: string
  [key: string]: unknown // Permite otras propiedades dinámicas
}

const GraphViewer = () => {
  const { id_coleccion } = useParams<{ id_coleccion: string }>()
  const { getAccessTokenSilently } = useAuth0()

  const [elements, setElements] = useState<ElementDefinition[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [cyRef, setCyRef] = useState<Core | null>(null)
  // En tu componente:
  const [selectedData, setSelectedData] = useState<GraphData | null>(null)
  const [selectedType, setSelectedType] = useState<'node' | 'edge' | null>(null)
  const [openingDocument, setOpeningDocument] = useState(false)

  const containerRef = useRef<HTMLDivElement>(null)
  const darkMode = useMemo(
    () => document.documentElement.classList.contains('dark'),
    [],
  )

  const renderValue = (k: string, v: unknown): string => {
    if (v == null) return ''
    const formatted =
      isProbablyDateKey(k) || isProbablyDateValue(v) ? formatDateValue(v) : v
    return String(formatted)
  }

  const runLayout = useCallback((cyInstance: Core | null) => {
  if (!cyInstance) return

  const layoutOptions: LayoutOptions = {
    name: 'breadthfirst',
    animate: true,
    animationDuration: 1000,
    fit: true,
    padding: 50,
    directed: true,      // Ordena de "origen" a "destino"
    grid: false,         // Si lo pones en true, los ordena en una cuadrícula rígida
    circle: false,       // Evita que se pongan en círculo
    spacingFactor: 2.5,  // Aumenta este número para más espacio entre niveles
  } as LayoutOptions & Record<string, unknown>

  cyInstance.layout(layoutOptions).run()
}, [])

  const openSourceDocument = useCallback(async () => {
    const docId = (selectedData as Record<string, unknown>)?.source_document_id
    if (!docId) return

    setOpeningDocument(true)
    try {
      const token = await getAccessTokenSilently()
      const res = await fetch(
        `${API_URL}/api/documentos/${String(docId)}/signed-url`,
        {
          headers: { Authorization: `Bearer ${token}` },
        },
      )

      if (!res.ok) throw new Error('No se pudo obtener la URL del documento.')

      const { signed_url } = await res.json()
      window.open(signed_url, '_blank')
    } catch (err) {
      console.error('Error abriendo documento fuente:', err)
    } finally {
      setOpeningDocument(false)
    }
  }, [getAccessTokenSilently, selectedData])

  useEffect(() => {
    if (cyRef && elements.length > 0) {
      runLayout(cyRef)
    }
  }, [cyRef, elements, runLayout])

  const fetchGraph = useCallback(async () => {
    if (!id_coleccion) return
    setLoading(true)
    setError(null)
    try {
      const token = await getAccessTokenSilently()
      const res = await fetch(
        `${API_URL}/api/collections/${id_coleccion}/graph`,
        {
          headers: { Authorization: 'Bearer ' + token },
        },
      )

      if (!res.ok) throw new Error(`Error al cargar el grafo`)

      const data: GraphResponse = await res.json()
      if (
        !data.elements ||
        (data.elements.nodes.length === 0 && data.elements.edges.length === 0)
      ) {
        throw new Error('No hay datos disponibles para visualizar.')
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
      setError(err instanceof Error ? err.message : 'Error desconocido')
    } finally {
      setLoading(false)
    }
  }, [id_coleccion, getAccessTokenSilently])

  // Reemplaza tu bloque useEffect actual (líneas 158-162) por este:
  useEffect(() => {
    const loadData = async () => {
      if (!id_coleccion) return
      await fetchGraph()
    }

    loadData()
  }, [id_coleccion, fetchGraph]) // fetchGraph ya está envuelto en useCallback

  useEffect(() => {
    if (!cyRef) return
    const handleSelect = (
      evt: cytoscape.EventObject,
      type: 'node' | 'edge',
    ) => {
      setSelectedData(evt.target.data())
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
    if (selectedType === 'edge') {
      return Object.entries(selectedData).filter(
        ([key, value]) => key === 'chunk_text' && value != null,
      )
    }
    const blacklist = [
      'id',
      'source',
      'target',
      'label',
      'chunk_text',
      'extracted_from',
      'source_document_id',
      'source_document_name',
    ]
    return Object.entries(selectedData).filter(
      ([key]) => !blacklist.includes(key),
    )
  }, [selectedData, selectedType])

  if (loading)
    return (
      <div className="gv-outer-wrapper gv-loading-container">
        <Loader2 className="gv-spin-loader animate-spin" size={48} />
        <p>Cargando grafo...</p>
      </div>
    )
  if (error)
    return (
      <div className="gv-outer-wrapper gv-error-container">
        <AlertCircle size={48} className="text-red-500" />
        <p>{error}</p>
        <button onClick={() => fetchGraph()} className="gv-retry-button">
          Reintentar
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
            <br />
            {selectedData?.source_document_id && (
              <div className="gv-source-ref">
                <span className="gv-source-ref-text">
                  <span className="gv-source-ref-label">Referencia:</span>{' '}
                  <span className="gv-source-ref-name">
                    {String(selectedData.source_document_name || 'Documento')}
                  </span>
                </span>
                <button
                  className="gv-source-ref-btn"
                  onClick={openSourceDocument}
                  disabled={openingDocument}
                  type="button"
                  title="Abrir documento fuente"
                >
                  {openingDocument ? '...' : '↗'}
                </button>
              </div>
            )}

            {filteredMetadata.map(([k, v]) => (
              <div key={k} className="gv-metadata-row">
                <span className="gv-metadata-key">
                  {k === 'chunk_text'
                    ? 'Descripción'
                    : k === 'type'
                      ? 'Tipo'
                      : k === 'nombre'
                        ? 'Nombre'
                        : k === 'descripcion'
                          ? 'Descripción'
                          : k === 'fecha'
                            ? 'Fecha'
                            : k === 'rol'
                              ? 'Rol'
                              : k === 'tipo'
                                ? 'Subtipo'
                                : k}
                </span>
                <span className="gv-metadata-val">{renderValue(k, v)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default GraphViewer
