import { render, screen } from '@testing-library/react'
import { Profile } from './profile'

const mockUseAuth0 = jest.fn()

jest.mock('@auth0/auth0-react', () => ({
  useAuth0: () => mockUseAuth0(),
}))

describe('Profile', () => {
  afterEach(() => {
    mockUseAuth0.mockReset()
  })

  it('muestra loading', () => {
    mockUseAuth0.mockReturnValue({
      user: undefined,
      isAuthenticated: false,
      isLoading: true,
    })
    render(<Profile />)
    expect(screen.getByText(/loading/i)).toBeInTheDocument()
  })

  it('muestra datos cuando hay sesión', () => {
    mockUseAuth0.mockReturnValue({
      user: {
        picture: 'https://example.com/p.png',
        name: 'Ana',
        email: 'ana@example.com',
      },
      isAuthenticated: true,
      isLoading: false,
    })
    render(<Profile />)
    expect(screen.getByRole('heading', { name: 'Ana' })).toBeInTheDocument()
    expect(screen.getByText('ana@example.com')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Ana' })).toHaveAttribute(
      'src',
      'https://example.com/p.png',
    )
  })

  it('no muestra perfil si no está autenticado', () => {
    mockUseAuth0.mockReturnValue({
      user: undefined,
      isAuthenticated: false,
      isLoading: false,
    })
    const { container } = render(<Profile />)
    expect(container.querySelector('.profile-container')).toBeNull()
  })
})
