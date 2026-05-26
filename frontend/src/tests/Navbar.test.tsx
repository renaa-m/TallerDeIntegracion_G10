import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Navbar from '../pages/navbar/navbar'

const mockLogout = jest.fn()
const mockGetToken = jest.fn()

type MockUser = {
  sub?: string
  nickname?: string
  name?: string
  email?: string
  picture?: string
}

let mockAuthState: {
  isAuthenticated: boolean
  user?: MockUser
} = {
  isAuthenticated: true,
  user: {
    sub: 'auth0|user123',
    nickname: 'testuser',
    name: 'Test User',
    email: 'test@example.com',
    picture: 'https://example.com/avatar.png',
  },
}

jest.mock('@auth0/auth0-react', () => ({
  useAuth0: () => ({
    ...mockAuthState,
    logout: mockLogout,
    getAccessTokenSilently: mockGetToken,
  }),
}))

jest.mock('../components/modal_eliminar_cuenta/modal_eliminar_cuenta', () => {
  return function MockModalEliminarCuenta({
    isOpen,
    onClose,
    onConfirm,
    isDeleting,
  }: {
    isOpen: boolean
    onClose: () => void
    onConfirm: () => void
    isDeleting: boolean
  }) {
    if (!isOpen) return null

    return (
      <div data-testid="modal-eliminar-cuenta">
        <p>Modal eliminar cuenta abierto</p>
        <p>{isDeleting ? 'Eliminando...' : 'Listo para eliminar'}</p>

        <button onClick={onClose}>Cerrar modal</button>
        <button onClick={onConfirm}>Confirmar eliminar cuenta</button>
      </div>
    )
  }
})

describe('Navbar', () => {
  beforeEach(() => {
    jest.clearAllMocks()

    mockAuthState = {
      isAuthenticated: true,
      user: {
        sub: 'auth0|user123',
        nickname: 'testuser',
        name: 'Test User',
        email: 'test@example.com',
        picture: 'https://example.com/avatar.png',
      },
    }

    mockGetToken.mockResolvedValue('fake-token')

    globalThis.fetch = jest.fn()

    process.env.VITE_API_URL = 'http://localhost:8080'

    window.alert = jest.fn()
  })

  const renderNavbar = () => {
    render(
      <MemoryRouter>
        <Navbar />
      </MemoryRouter>,
    )
  }

  test('renderiza navbar correctamente cuando usuario está autenticado', () => {
    renderNavbar()

    expect(document.querySelector('.navbar')).toBeInTheDocument()
    expect(document.querySelector('.navbar-logo')).toBeInTheDocument()
    expect(document.querySelector('.profile-trigger')).toBeInTheDocument()
    expect(document.querySelector('.nav-avatar')).toBeInTheDocument()
  })

  test('NO renderiza dropdown si usuario no está autenticado', () => {
    mockAuthState = {
      isAuthenticated: false,
      user: undefined,
    }

    renderNavbar()

    expect(document.querySelector('.profile-trigger')).not.toBeInTheDocument()
    expect(screen.queryByText('Cerrar Sesión')).not.toBeInTheDocument()
  })

  test('link del logo navega al landing page autenticado', () => {
    renderNavbar()

    const brand = document.querySelector('.navbar-brand') as HTMLAnchorElement

    expect(brand.getAttribute('href')).toBe('/landing-page/user123')
  })

  test('link del logo navega a / cuando no está autenticado', () => {
    mockAuthState = {
      isAuthenticated: false,
      user: undefined,
    }

    renderNavbar()

    const brand = document.querySelector('.navbar-brand') as HTMLAnchorElement

    expect(brand.getAttribute('href')).toBe('/')
  })

  test('abre y cierra dropdown del perfil', () => {
    renderNavbar()

    const trigger = document.querySelector(
      '.profile-trigger',
    ) as HTMLButtonElement

    fireEvent.click(trigger)

    expect(screen.getByText('Test User')).toBeInTheDocument()
    expect(screen.getByText('test@example.com')).toBeInTheDocument()
    expect(screen.getByText('Cerrar Sesión')).toBeInTheDocument()
    expect(screen.getByText('Eliminar Cuenta')).toBeInTheDocument()

    fireEvent.click(trigger)

    expect(screen.queryByText('Cerrar Sesión')).not.toBeInTheDocument()
  })

  test('muestra avatar placeholder si usuario no tiene picture', () => {
    mockAuthState = {
      isAuthenticated: true,
      user: {
        sub: 'auth0|user123',
        nickname: 'testuser',
        name: 'Test User',
        email: 'test@example.com',
        picture: '',
      },
    }

    renderNavbar()

    expect(
      document.querySelector('.nav-avatar-placeholder'),
    ).toBeInTheDocument()
    expect(document.querySelector('.nav-avatar')).not.toBeInTheDocument()
  })

  test('usa nickname si sub no existe', () => {
    mockAuthState = {
      isAuthenticated: true,
      user: {
        nickname: 'nickname123',
        name: 'Test User',
        email: 'test@example.com',
        picture: '',
      },
    }

    renderNavbar()

    const brand = document.querySelector('.navbar-brand') as HTMLAnchorElement

    expect(brand.getAttribute('href')).toBe('/landing-page/nickname123')
  })

  test('llama logout al hacer click en Cerrar Sesión', () => {
    renderNavbar()

    fireEvent.click(document.querySelector('.profile-trigger') as HTMLElement)

    fireEvent.click(screen.getByText('Cerrar Sesión'))

    expect(mockLogout).toHaveBeenCalledWith({
      logoutParams: {
        returnTo: window.location.origin,
      },
    })
  })

  test('abre modal eliminar cuenta y cierra dropdown', () => {
    renderNavbar()

    fireEvent.click(document.querySelector('.profile-trigger') as HTMLElement)

    fireEvent.click(screen.getByText('Eliminar Cuenta'))

    expect(screen.getByTestId('modal-eliminar-cuenta')).toBeInTheDocument()

    expect(screen.queryByText('Cerrar Sesión')).not.toBeInTheDocument()
  })

  test('cierra modal eliminar cuenta', () => {
    renderNavbar()

    fireEvent.click(document.querySelector('.profile-trigger') as HTMLElement)

    fireEvent.click(screen.getByText('Eliminar Cuenta'))

    fireEvent.click(screen.getByText('Cerrar modal'))

    expect(
      screen.queryByTestId('modal-eliminar-cuenta'),
    ).not.toBeInTheDocument()
  })

  test('elimina cuenta exitosamente y hace logout', async () => {
    ;(globalThis.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({}),
    })

    renderNavbar()

    fireEvent.click(document.querySelector('.profile-trigger') as HTMLElement)

    fireEvent.click(screen.getByText('Eliminar Cuenta'))

    fireEvent.click(screen.getByText('Confirmar eliminar cuenta'))

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        'http://localhost:8080/usuarios/me',
        expect.objectContaining({
          method: 'DELETE',
          headers: {
            Authorization: 'Bearer fake-token',
          },
        }),
      )
    })

    expect(mockLogout).toHaveBeenCalledWith({
      logoutParams: {
        returnTo: window.location.origin,
      },
    })
  })

  test('muestra alert si backend responde error al eliminar cuenta', async () => {
    ;(globalThis.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({
        detail: 'Backend error',
      }),
    })

    renderNavbar()

    fireEvent.click(document.querySelector('.profile-trigger') as HTMLElement)

    fireEvent.click(screen.getByText('Eliminar Cuenta'))

    fireEvent.click(screen.getByText('Confirmar eliminar cuenta'))

    await waitFor(() => {
      expect(window.alert).toHaveBeenCalledWith(
        'Hubo un error al eliminar la cuenta.',
      )
    })

    expect(mockLogout).not.toHaveBeenCalled()
  })

  test('muestra alert si fetch falla completamente', async () => {
    ;(globalThis.fetch as jest.Mock).mockRejectedValueOnce(
      new Error('Network error'),
    )

    renderNavbar()

    fireEvent.click(document.querySelector('.profile-trigger') as HTMLElement)

    fireEvent.click(screen.getByText('Eliminar Cuenta'))

    fireEvent.click(screen.getByText('Confirmar eliminar cuenta'))

    await waitFor(() => {
      expect(window.alert).toHaveBeenCalledWith(
        'No se pudo conectar con el servidor.',
      )
    })

    expect(mockLogout).not.toHaveBeenCalled()
  })

  test('muestra estado Eliminando mientras request está en progreso', async () => {
    let resolveFetch:
      | ((value: {
          ok: boolean
          status: number
          json: () => Promise<object>
        }) => void)
      | undefined
    ;(globalThis.fetch as jest.Mock).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve
        }),
    )

    renderNavbar()

    fireEvent.click(document.querySelector('.profile-trigger') as HTMLElement)
    fireEvent.click(screen.getByText('Eliminar Cuenta'))
    fireEvent.click(screen.getByText('Confirmar eliminar cuenta'))

    expect(screen.getByText('Eliminando...')).toBeInTheDocument()

    await waitFor(() => {
      expect(resolveFetch).toBeDefined()
    })

    await act(async () => {
      resolveFetch?.({
        ok: true,
        status: 200,
        json: async () => ({}),
      })
    })

    await waitFor(() => {
      expect(mockLogout).toHaveBeenCalledWith({
        logoutParams: {
          returnTo: window.location.origin,
        },
      })
    })
  })

  test('cierra modal después de terminar eliminación', async () => {
    ;(globalThis.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({}),
    })

    renderNavbar()

    fireEvent.click(document.querySelector('.profile-trigger') as HTMLElement)

    fireEvent.click(screen.getByText('Eliminar Cuenta'))

    fireEvent.click(screen.getByText('Confirmar eliminar cuenta'))

    await waitFor(() => {
      expect(
        screen.queryByTestId('modal-eliminar-cuenta'),
      ).not.toBeInTheDocument()
    })
  })

  test('rota chevron cuando dropdown está abierto', () => {
    renderNavbar()

    const trigger = document.querySelector('.profile-trigger') as HTMLElement

    fireEvent.click(trigger)

    expect(document.querySelector('.chevron')).toHaveClass('rotate')
  })

  test('no rota chevron cuando dropdown está cerrado', () => {
    renderNavbar()

    expect(document.querySelector('.chevron')).not.toHaveClass('rotate')
  })

  test('muestra nombre Usuario por defecto si user.name no existe', () => {
    mockAuthState = {
      isAuthenticated: true,
      user: {
        sub: 'auth0|user123',
        nickname: 'testuser',
        email: 'test@example.com',
        picture: '',
      },
    }

    renderNavbar()

    fireEvent.click(document.querySelector('.profile-trigger') as HTMLElement)

    expect(screen.getByText('Usuario')).toBeInTheDocument()
  })
})
