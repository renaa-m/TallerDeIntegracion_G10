import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const mockUseAuth0 = jest.fn()

jest.mock('@auth0/auth0-react', () => ({
  useAuth0: () => mockUseAuth0(),
}))

jest.mock('./pages/landing_page/landing_page', () => ({
  __esModule: true,
  default: function LandingStub() {
    return <div data-testid="landing-stub">Landing</div>
  },
}))

jest.mock('./pages/buscador_coleccion/buscador_coleccion', () => ({
  __esModule: true,
  default: function BuscadorStub() {
    return <div data-testid="buscador-stub">Buscador</div>
  },
}))

jest.mock('./pages/navbar/navbar', () => ({
  __esModule: true,
  default: function NavbarStub() {
    return <nav data-testid="navbar-stub">Navbar</nav>
  },
}))

import App from './App'

describe('App', () => {
  afterEach(() => {
    mockUseAuth0.mockReset()
  })

  it('muestra spinner mientras carga la sesión', () => {
    mockUseAuth0.mockReturnValue({
      isLoading: true,
      isAuthenticated: false,
      user: undefined,
      logout: jest.fn(),
      getAccessTokenSilently: jest.fn(),
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
      user: undefined,
      logout: jest.fn(),
      getAccessTokenSilently: jest.fn(),
    })
    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>,
    )
    expect(
      screen.getByRole('heading', { name: /notebookimfd/i }),
    ).toBeInTheDocument()
    expect(screen.getByTestId('navbar-stub')).toBeInTheDocument()
  })
})
