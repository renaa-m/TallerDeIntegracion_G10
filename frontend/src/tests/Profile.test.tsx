import { render, screen } from '@testing-library/react'
import { Profile } from '../profile'

let mockAuthState: {
    isLoading: boolean
    isAuthenticated: boolean
    user?: {
        name?: string
        email?: string
        picture?: string
    }
    } = {
    isLoading: false,
    isAuthenticated: false,
    user: undefined,
    }

    jest.mock('@auth0/auth0-react', () => ({
    useAuth0: () => mockAuthState,
    }))

    describe('Profile', () => {
    beforeEach(() => {
        jest.clearAllMocks()

        mockAuthState = {
        isLoading: false,
        isAuthenticated: false,
        user: undefined,
        }
    })

    test('muestra Loading cuando isLoading es true', () => {
        mockAuthState = {
        isLoading: true,
        isAuthenticated: false,
        user: undefined,
        }

        render(<Profile />)

        expect(screen.getByText('Loading...')).toBeInTheDocument()
    })

    test('renderiza perfil cuando usuario está autenticado', () => {
        mockAuthState = {
        isLoading: false,
        isAuthenticated: true,
        user: {
            name: 'Antonia',
            email: 'antonia@test.com',
            picture: 'https://example.com/avatar.png',
        },
        }

        render(<Profile />)

        expect(screen.getByText('Antonia')).toBeInTheDocument()
        expect(screen.getByText('antonia@test.com')).toBeInTheDocument()

        const image = screen.getByRole('img') as HTMLImageElement

        expect(image).toBeInTheDocument()
        expect(image).toHaveAttribute('src', 'https://example.com/avatar.png')
        expect(image.alt).toBe('Antonia')
    })

    test('no renderiza perfil cuando usuario NO está autenticado', () => {
        mockAuthState = {
        isLoading: false,
        isAuthenticated: false,
        user: {
            name: 'Antonia',
            email: 'antonia@test.com',
            picture: 'https://example.com/avatar.png',
        },
        }

        render(<Profile />)

        expect(screen.queryByText('Antonia')).not.toBeInTheDocument()
        expect(screen.queryByText('antonia@test.com')).not.toBeInTheDocument()
        expect(screen.queryByRole('img')).not.toBeInTheDocument()
    })

    test('no renderiza perfil si user es undefined', () => {
        mockAuthState = {
        isLoading: false,
        isAuthenticated: true,
        user: undefined,
        }

        render(<Profile />)

        expect(screen.queryByRole('img')).not.toBeInTheDocument()
    })

    test('renderiza clases CSS correctamente', () => {
        mockAuthState = {
        isLoading: false,
        isAuthenticated: true,
        user: {
            name: 'Antonia',
            email: 'antonia@test.com',
            picture: 'https://example.com/avatar.png',
        },
        }

        render(<Profile />)

        expect(document.querySelector('.profile-container')).toBeInTheDocument()
        expect(document.querySelector('.profile-picture')).toBeInTheDocument()
        expect(document.querySelector('.profile-name')).toBeInTheDocument()
        expect(document.querySelector('.profile-email')).toBeInTheDocument()
    })

    test('renderiza correctamente aunque falte email', () => {
        mockAuthState = {
        isLoading: false,
        isAuthenticated: true,
        user: {
            name: 'Antonia',
            picture: 'https://example.com/avatar.png',
        },
        }

        render(<Profile />)

        expect(screen.getByText('Antonia')).toBeInTheDocument()
    })
})