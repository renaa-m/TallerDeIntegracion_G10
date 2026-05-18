import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import App from '../App'

const mockNavigate = jest.fn()

let mockAuthState: {
    isAuthenticated: boolean
    isLoading: boolean
    user?: {
        sub?: string
        nickname?: string
    }
    } = {
    isAuthenticated: false,
    isLoading: false,
    user: undefined,
    }

    jest.mock('@auth0/auth0-react', () => ({
    useAuth0: () => mockAuthState,
    }))

    jest.mock('../pages/navbar/navbar', () => {
    return function MockNavbar() {
        return <div data-testid="navbar">Navbar</div>
    }
    })

    jest.mock('../pages/login_page/login_page', () => {
    return function MockLoginPage() {
        return <div data-testid="login-page">Login Page</div>
    }
    })

    jest.mock('../pages/landing_page/landing_page', () => {
    return function MockLandingPage() {
        return <div data-testid="landing-page">Landing Page</div>
    }
    })

    jest.mock('../pages/buscador_coleccion/buscador_coleccion', () => {
    return function MockBuscadorColeccion() {
        return <div data-testid="buscador-page">Buscador Colección</div>
    }
    })

    jest.mock('react-router-dom', () => ({
    ...jest.requireActual('react-router-dom'),
    useNavigate: () => mockNavigate,
    }))

    describe('App', () => {
    beforeEach(() => {
        jest.clearAllMocks()

        mockAuthState = {
        isAuthenticated: false,
        isLoading: false,
        user: undefined,
        }
    })

    const renderApp = (initialRoute = '/') => {
        render(
        <MemoryRouter initialEntries={[initialRoute]}>
            <App />
        </MemoryRouter>,
        )
    }

    test('muestra pantalla de loading cuando isLoading es true', () => {
        mockAuthState = {
        isAuthenticated: false,
        isLoading: true,
        user: undefined,
        }

        renderApp()

        expect(screen.getByText('Sincronizando...')).toBeInTheDocument()
        expect(document.querySelector('.animate-spin')).toBeInTheDocument()
    })

    test('renderiza LoginPage en / cuando usuario NO está autenticado', () => {
        mockAuthState = {
        isAuthenticated: false,
        isLoading: false,
        user: undefined,
        }

        renderApp('/')

        expect(screen.getByTestId('navbar')).toBeInTheDocument()
        expect(screen.getByTestId('login-page')).toBeInTheDocument()
    })

    test('redirige desde / a landing page cuando usuario está autenticado', async () => {
        mockAuthState = {
        isAuthenticated: true,
        isLoading: false,
        user: {
            sub: 'auth0|user123',
        },
        }

        renderApp('/')

        await waitFor(() => {
        expect(screen.getByTestId('landing-page')).toBeInTheDocument()
        })
    })

    test('renderiza LandingPage cuando usuario autenticado entra a landing-page/:id_usuario', () => {
        mockAuthState = {
        isAuthenticated: true,
        isLoading: false,
        user: {
            sub: 'auth0|user123',
        },
        }

        renderApp('/landing-page/user123')

        expect(screen.getByTestId('landing-page')).toBeInTheDocument()
    })

    test('redirige a LoginPage si usuario NO autenticado intenta entrar a landing-page', async () => {
        mockAuthState = {
        isAuthenticated: false,
        isLoading: false,
        user: undefined,
        }

        renderApp('/landing-page/user123')

        await waitFor(() => {
        expect(screen.getByTestId('login-page')).toBeInTheDocument()
        })
    })

    test('renderiza BuscadorColeccion cuando usuario autenticado entra a colección', () => {
        mockAuthState = {
        isAuthenticated: true,
        isLoading: false,
        user: {
            sub: 'auth0|user123',
        },
        }

        renderApp('/user123/colecciones/collection-1/buscador')

        expect(screen.getByTestId('buscador-page')).toBeInTheDocument()
    })

    test('redirige a LoginPage si usuario NO autenticado entra a colección', async () => {
        mockAuthState = {
        isAuthenticated: false,
        isLoading: false,
        user: undefined,
        }

        renderApp('/user123/colecciones/collection-1/buscador')

        await waitFor(() => {
        expect(screen.getByTestId('login-page')).toBeInTheDocument()
        })
    })

    test('renderiza BuscadorColeccion en ruta buscador-coleccion', () => {
        mockAuthState = {
        isAuthenticated: true,
        isLoading: false,
        user: {
            sub: 'auth0|user123',
        },
        }

        renderApp('/user123/buscador-coleccion')

        expect(screen.getByTestId('buscador-page')).toBeInTheDocument()
    })

    test('renderiza LoginPage en /login cuando usuario NO autenticado', () => {
        mockAuthState = {
        isAuthenticated: false,
        isLoading: false,
        user: undefined,
        }

        renderApp('/login')

        expect(screen.getByTestId('login-page')).toBeInTheDocument()
    })

    test('redirige desde /login cuando usuario ya autenticado', async () => {
        mockAuthState = {
        isAuthenticated: true,
        isLoading: false,
        user: {
            sub: 'auth0|user123',
        },
        }

        renderApp('/login')

        await waitFor(() => {
        expect(screen.getByTestId('landing-page')).toBeInTheDocument()
        })
    })

    test('CallbackHandler navega a landing page después de autenticación', async () => {
        mockAuthState = {
        isAuthenticated: true,
        isLoading: false,
        user: {
            sub: 'auth0|callbackuser',
        },
        }

        renderApp('/callback')

        await waitFor(() => {
        expect(mockNavigate).toHaveBeenCalledWith(
            '/landing-page/callbackuser',
            { replace: true },
        )
        })

        expect(screen.getByText('Sincronizando...')).toBeInTheDocument()
    })

    test('CallbackHandler usa nickname si no existe sub', async () => {
        mockAuthState = {
        isAuthenticated: true,
        isLoading: false,
        user: {
            nickname: 'nick123',
        },
        }

        renderApp('/callback')

        await waitFor(() => {
        expect(mockNavigate).toHaveBeenCalledWith(
            '/landing-page/nick123',
            { replace: true },
        )
        })
    })

    test('CallbackHandler NO navega si todavía está loading', async () => {
        mockAuthState = {
        isAuthenticated: true,
        isLoading: true,
        user: {
            sub: 'auth0|user123',
        },
        }

        renderApp('/callback')

        expect(mockNavigate).not.toHaveBeenCalled()
    })

    test('ruta desconocida redirige a /', async () => {
        mockAuthState = {
        isAuthenticated: false,
        isLoading: false,
        user: undefined,
        }

        renderApp('/ruta-que-no-existe')

        await waitFor(() => {
        expect(screen.getByTestId('login-page')).toBeInTheDocument()
        })
    })

    test('Navbar siempre se renderiza cuando no está loading', () => {
        mockAuthState = {
        isAuthenticated: false,
        isLoading: false,
        user: undefined,
        }

        renderApp('/')

        expect(screen.getByTestId('navbar')).toBeInTheDocument()
    })

    test('usa nickname para redirects si no existe sub', async () => {
        mockAuthState = {
        isAuthenticated: true,
        isLoading: false,
        user: {
            nickname: 'nickname123',
        },
        }

        renderApp('/')

        await waitFor(() => {
        expect(screen.getByTestId('landing-page')).toBeInTheDocument()
        })
    })

    test('renderiza estructura principal de layout', () => {
        mockAuthState = {
        isAuthenticated: false,
        isLoading: false,
        user: undefined,
        }

        renderApp('/')

        expect(document.querySelector('main')).toBeInTheDocument()
    })
})