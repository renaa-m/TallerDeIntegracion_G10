import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import LoginPage from './login_page'

const mockLoginWithRedirect = jest.fn()

jest.mock('@auth0/auth0-react', () => ({
  useAuth0: () => ({
    loginWithRedirect: mockLoginWithRedirect,
  }),
}))

describe('LoginPage', () => {
  beforeEach(() => {
    mockLoginWithRedirect.mockClear()
  })

  it('muestra marca y botón de login', () => {
    render(<LoginPage />)
    expect(
      screen.getByRole('heading', { name: /notebookimfd/i }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /iniciar sesión/i }),
    ).toBeInTheDocument()
  })

  it('llama loginWithRedirect al hacer clic', async () => {
    const user = userEvent.setup()
    mockLoginWithRedirect.mockResolvedValue(undefined)
    render(<LoginPage />)
    await user.click(screen.getByRole('button', { name: /iniciar sesión/i }))
    expect(mockLoginWithRedirect).toHaveBeenCalledTimes(1)
  })
})
