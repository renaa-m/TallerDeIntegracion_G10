import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import LoginPage from '../pages/login_page/login_page'

const mockLoginWithRedirect = jest.fn()

jest.mock('@auth0/auth0-react', () => ({
  useAuth0: () => ({
    loginWithRedirect: mockLoginWithRedirect,
  }),
}))

describe('LoginPage', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  test('renderiza la página de login', () => {
    render(<LoginPage />)

    expect(screen.getByText('NotebookIMFD')).toBeInTheDocument()
    expect(
      screen.getByText(
        'Plataforma de Investigación en Humanidades Digitales del IMFD.',
      ),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /iniciar sesión/i }),
    ).toBeInTheDocument()
    expect(
      screen.getByText('Instituto Milenio Fundamentos de los Datos'),
    ).toBeInTheDocument()
  })

  test('llama loginWithRedirect al hacer click en Iniciar Sesión', async () => {
    mockLoginWithRedirect.mockResolvedValueOnce(undefined)

    render(<LoginPage />)

    fireEvent.click(screen.getByRole('button', { name: /iniciar sesión/i }))

    await waitFor(() => {
      expect(mockLoginWithRedirect).toHaveBeenCalledTimes(1)
    })
  })

  test('maneja error si loginWithRedirect falla', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    const error = new Error('Auth error')

    mockLoginWithRedirect.mockRejectedValueOnce(error)

    render(<LoginPage />)

    fireEvent.click(screen.getByRole('button', { name: /iniciar sesión/i }))

    await waitFor(() => {
      expect(consoleSpy).toHaveBeenCalledWith('Error al iniciar sesión:', error)
    })

    consoleSpy.mockRestore()
  })

  test('renderiza clases principales', () => {
    render(<LoginPage />)

    expect(document.querySelector('.login-page-wrapper')).toBeInTheDocument()
    expect(document.querySelector('.login-card')).toBeInTheDocument()
    expect(document.querySelector('.icon-box')).toBeInTheDocument()
    expect(document.querySelector('.footer-brand')).toBeInTheDocument()
  })
})
