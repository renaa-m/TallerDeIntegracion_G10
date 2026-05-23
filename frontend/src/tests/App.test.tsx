import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import App from '../App'

const mockNavigate = jest.fn()

let mockAuthState: {
  isAuthenticated: boolean
  isLoading: boolean
  user?: { sub?: string; nickname?: string }
} = {
  isAuthenticated: false,
  isLoading: false,
  user: undefined,
}

// Mocks
jest.mock('@auth0/auth0-react', () => ({
  useAuth0: () => mockAuthState,
}))

jest.mock('../pages/navbar/navbar', () => () => <nav data-testid="navbar">Navbar</nav>)
jest.mock('../pages/login_page/login_page', () => () => <div data-testid="login-page">Login Page</div>)
jest.mock('../pages/landing_page/landing_page', () => () => <div data-testid="landing-page">Landing Page</div>)
jest.mock('../pages/visualizador_grafo/visualizador_grafo', () => () => <div data-testid="grafo-page">Grafo Page</div>)

// Mock Buscador con Outlet para rutas anidadas
jest.mock('../pages/buscador_coleccion/buscador_coleccion', () => {
  return function MockBuscadorColeccion() {
    // Importamos Outlet aquí dentro, donde es seguro
    const { Outlet } = jest.requireActual('react-router-dom')
    
    return (
      <div data-testid="buscador-page">
        Buscador Colección
        <Outlet />
      </div>
    )
  }
})

jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useNavigate: () => mockNavigate,
}))

describe('App', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockAuthState = { isAuthenticated: false, isLoading: false, user: undefined }
  })

  const renderApp = (initialRoute = '/') => {
    render(
      <MemoryRouter initialEntries={[initialRoute]}>
        <App />
      </MemoryRouter>,
    )
  }

  // --- Tests de Estado de Autenticación y Carga ---
  test('muestra pantalla de loading cuando isLoading es true', () => {
    mockAuthState = { isAuthenticated: false, isLoading: true }
    renderApp()
    expect(screen.getByText(/sincronizando/i)).toBeInTheDocument()
  })

  test('renderiza LoginPage en / cuando usuario NO autenticado', () => {
    renderApp('/')
    expect(screen.getByTestId('navbar')).toBeInTheDocument()
    expect(screen.getByTestId('login-page')).toBeInTheDocument()
  })

  // --- Tests de Navegación de Rutas ---
  test('redirige desde / a landing page cuando usuario autenticado', async () => {
    mockAuthState = { isAuthenticated: true, isLoading: false, user: { sub: 'auth0|user123' } }
    renderApp('/')
    await waitFor(() => expect(screen.getByTestId('landing-page')).toBeInTheDocument())
  })

  test('renderiza BuscadorColeccion y el Grafo en rutas anidadas', () => {
    mockAuthState = { isAuthenticated: true, isLoading: false, user: { sub: 'auth0|user123' } }
    renderApp('/user123/colecciones/collection-1/grafo')
    
    expect(screen.getByTestId('buscador-page')).toBeInTheDocument()
    expect(screen.getByTestId('grafo-page')).toBeInTheDocument()
  })

  test('redirige a LoginPage si usuario NO autenticado intenta entrar a colección', async () => {
    renderApp('/user123/colecciones/collection-1/buscador')
    await waitFor(() => expect(screen.getByTestId('login-page')).toBeInTheDocument())
  })

  // --- Tests de CallbackHandler ---
  test('CallbackHandler navega a landing page después de autenticación', async () => {
    mockAuthState = { isAuthenticated: true, isLoading: false, user: { sub: 'auth0|callbackuser' } }
    renderApp('/callback')
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/landing-page/callbackuser', { replace: true })
    })
  })

  test('CallbackHandler usa nickname si no existe sub', async () => {
    mockAuthState = { isAuthenticated: true, isLoading: false, user: { nickname: 'nick123' } }
    renderApp('/callback')
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/landing-page/nick123', { replace: true })
    })
  })

  test('CallbackHandler NO navega si está en loading', () => {
    mockAuthState = { isAuthenticated: true, isLoading: true, user: { sub: 'auth0|user123' } }
    renderApp('/callback')
    expect(mockNavigate).not.toHaveBeenCalled()
  })

  // --- Tests Generales de UI ---
  test('Navbar siempre se renderiza cuando no está loading', () => {
    renderApp('/')
    expect(screen.getByTestId('navbar')).toBeInTheDocument()
  })

  test('ruta desconocida redirige a /', async () => {
    renderApp('/ruta-que-no-existe')
    await waitFor(() => expect(screen.getByTestId('login-page')).toBeInTheDocument())
  })
})