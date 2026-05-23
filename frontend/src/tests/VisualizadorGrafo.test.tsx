import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import GraphViewer from '../pages/visualizador_grafo/visualizador_grafo';
import { useAuth0 } from '@auth0/auth0-react';

// 1. Mock de la librería gráfica (Cytoscape) con tipos correctos
jest.mock('react-cytoscapejs', () => {
  return function MockCytoscape({ 
    cy, 
    elements 
  }: { 
    cy?: (instance: unknown) => void; 
    elements?: unknown[]; 
  }) {
    if (cy) {
      cy({
        layout: () => ({ run: jest.fn() }),
        resize: jest.fn(),
        zoom: jest.fn(),
        elements: () => ({ unselect: jest.fn() }),
        on: jest.fn(),
        off: jest.fn(),
      });
    }
    return <div data-testid="cytoscape-canvas">{elements?.length || 0}</div>;
  };
});

// 2. Mock de dependencias
jest.mock('@auth0/auth0-react');
jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useParams: () => ({ id_coleccion: '123' }),
}));

describe('VisualizadorGrafo Component Coverage', () => {
  beforeEach(() => {
    (useAuth0 as jest.Mock).mockReturnValue({
      getAccessTokenSilently: jest.fn().mockResolvedValue('mock-token'),
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('debe ejecutar el flujo completo de carga y mostrar el grafo', async () => {
    // Mock del fetch con datos reales para forzar cobertura
    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          elements: {
            nodes: [{ data: { id: '1', label: 'Nodo Test' } }],
            edges: [{ data: { id: 'e1', source: '1', target: '1', label: 'Relación' } }]
          }
        }),
      })
    ) as jest.Mock;

    render(
      <MemoryRouter>
        <GraphViewer />
      </MemoryRouter>
    );

    // Debe mostrar cargando inicialmente
    expect(screen.getByText(/Cargando grafo/i)).toBeInTheDocument();

    // Esperamos a que la lógica asíncrona termine (esto dispara la cobertura)
    await waitFor(() => {
      expect(screen.queryByText(/Cargando grafo/i)).not.toBeInTheDocument();
    });

    // Verificamos que el canvas (el mock) esté presente
    expect(screen.getByTestId('cytoscape-canvas')).toBeInTheDocument();
  });

  it('debe mostrar error cuando la respuesta del servidor es fallida', async () => {
    global.fetch = jest.fn(() =>
      Promise.resolve({ ok: false })
    ) as jest.Mock;

    render(
      <MemoryRouter>
        <GraphViewer />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/Error al cargar el grafo/i)).toBeInTheDocument();
    });
  });

  it('debe mostrar mensaje si no hay datos', async () => {
    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ elements: { nodes: [], edges: [] } })
      })
    ) as jest.Mock;

    render(
      <MemoryRouter>
        <GraphViewer />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/No hay datos disponibles para visualizar/i)).toBeInTheDocument();
    });
  });
});