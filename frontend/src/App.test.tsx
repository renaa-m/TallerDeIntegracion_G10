import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import App from './App'

// Mock de Auth0
const mockUseAuth0 = jest.fn()
jest.mock('@auth0/auth0-react', () => ({
  useAuth0: () => mockUseAuth0(),
}))

// Mocks de páginas y componentes
jest.mock('./pages/landing_page/landing_page', () => ({
  __esModule: true,
  default: () => <div data-testid="landing-stub">Landing</div>,
}))

jest.mock('./pages/buscador_coleccion/buscador_coleccion', () => ({
  __esModule: true,
  // IMPORTANTE: Buscador debe renderizar el Outlet para que los hijos funcionen
  default: function BuscadorStub() {
    const { Outlet } = jest.requireActual('react-router-dom')
    return (
      <div data-testid="buscador-stub">
        Buscador
        <Outlet />
      </div>
    )
  },
}))

jest.mock('./pages/visualizador_grafo/visualizador_grafo', () => ({
  __esModule: true,
  default: () => <div data-testid="grafo-stub">Grafo</div>,
}))

jest.mock('./pages/navbar/navbar', () => ({
  __esModule: true,
  default: () => <nav data-testid="navbar-stub">Navbar</nav>,
}))

jest.mock('./pages/login_page/login_page', () => ({
  __esModule: true,
  default: () => (
    <div>
      <h1>NotebookIMFD</h1>
    </div>
  ),
}))

describe('App', () => {
  afterEach(() => {
    mockUseAuth0.mockReset()
  })

  it('muestra spinner mientras carga la sesión', () => {
    mockUseAuth0.mockReturnValue({
      isLoading: true,
      isAuthenticated: false,
    })
    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>,
    )
    expect(screen.getByText(/sincronizando/i)).toBeInTheDocument()
  })

  it('sin sesión muestra la página de login en /', () => {
    mockUseAuth0.mockReturnValue({
      isLoading: false,
      isAuthenticated: false,
    })
    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>,
    )
    expect(screen.getByText(/notebookimfd/i)).toBeInTheDocument()
  })

  it('renderiza el Grafo cuando la ruta es /:id/colecciones/:id/grafo', () => {
    mockUseAuth0.mockReturnValue({
      isLoading: false,
      isAuthenticated: true,
      user: { sub: 'auth0|123' },
    })

    render(
      <MemoryRouter initialEntries={['/123/colecciones/456/grafo']}>
        <App />
      </MemoryRouter>,
    )

    // Verifica que el buscador esté presente (padre) y el grafo (hijo)
    expect(screen.getByTestId('buscador-stub')).toBeInTheDocument()
    expect(screen.getByTestId('grafo-stub')).toBeInTheDocument()
  })
})
