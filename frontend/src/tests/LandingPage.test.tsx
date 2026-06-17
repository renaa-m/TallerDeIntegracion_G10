import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import LandingPage from '../pages/landing_page/landing_page'

const mockNavigate = jest.fn()
const mockGetToken = jest.fn()

let mockParams = {
  id_usuario: 'user123',
}

let mockUser: {
  sub?: string
  nickname?: string
  given_name?: string
} = {
  sub: 'auth0|user123',
  nickname: 'anto',
  given_name: 'Anto',
}
let mockIsAuthenticated = true
let mockIsLoading = false

jest.mock('@auth0/auth0-react', () => ({
  useAuth0: () => ({
    user: mockUser,
    isAuthenticated: mockIsAuthenticated,
    isLoading: mockIsLoading,
    getAccessTokenSilently: mockGetToken,
  }),
}))

jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useNavigate: () => mockNavigate,
  useParams: () => mockParams,
}))

const API_BASE = 'http://localhost:8080'

const coleccionesMock = [
  {
    id: 'collection-1',
    user_id: 'user123',
    name: 'Coleccion Uno',
    description: null,
    status: 'created',
    created_at: '2024-01-01T00:00:00Z',
  },
  {
    id: 'collection-2',
    user_id: 'user123',
    name: 'Coleccion Dos',
    description: null,
    status: 'created',
    created_at: '2024-01-02T00:00:00Z',
  },
]

describe('LandingPage', () => {
  beforeEach(() => {
    jest.clearAllMocks()

    mockIsAuthenticated = true
    mockIsLoading = false

    mockParams = {
      id_usuario: 'user123',
    }

    mockUser = {
      sub: 'auth0|user123',
      nickname: 'anto',
      given_name: 'Anto',
    }

    mockGetToken.mockResolvedValue('fake-token')
    globalThis.fetch = jest.fn()
  })

  const renderPage = () => {
    render(
      <MemoryRouter>
        <LandingPage />
      </MemoryRouter>,
    )
  }

  test('renderiza saludo y carga colecciones', async () => {
    ;(globalThis.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => coleccionesMock,
    })

    renderPage()

    expect(
      screen.getByRole('heading', { level: 1, name: /hola, anto/i }),
    ).toBeInTheDocument()
    expect(screen.getByText(/cargando colecciones/i)).toBeInTheDocument()

    expect(await screen.findByText('Coleccion Uno')).toBeInTheDocument()
    expect(screen.getByText('Coleccion Dos')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /nueva colecci/i }),
    ).toBeInTheDocument()

    expect(globalThis.fetch).toHaveBeenCalledWith(
      `${API_BASE}/api/collections`,
      expect.objectContaining({
        headers: {
          Authorization: 'Bearer fake-token',
        },
      }),
    )
  })

  test('muestra mensaje cuando no hay colecciones', async () => {
    ;(globalThis.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => [],
    })

    renderPage()

    expect(
      await screen.findByText(/no tienes colecciones todav/i),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /iniciar/i })).toBeInTheDocument()
  })

  test('muestra error si falla la carga de colecciones', async () => {
    ;(globalThis.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      json: async () => ({ detail: 'Error backend' }),
    })

    renderPage()

    expect(await screen.findByText('Error')).toBeInTheDocument()
    expect(
      screen.getByText('No se pudieron cargar las colecciones'),
    ).toBeInTheDocument()
  })

  test('cierra popup de error', async () => {
    ;(globalThis.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      json: async () => ({ detail: 'Error backend' }),
    })

    renderPage()

    expect(
      await screen.findByText('No se pudieron cargar las colecciones'),
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /cerrar/i }))

    expect(
      screen.queryByText('No se pudieron cargar las colecciones'),
    ).not.toBeInTheDocument()
  })

  test('navega a nueva coleccion al presionar Iniciar', async () => {
    ;(globalThis.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => [],
    })

    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: /iniciar/i }))

    expect(mockNavigate).toHaveBeenCalledWith(
      '/user123/colecciones/nueva/buscador',
      {
        state: { abrirModalCarga: true },
      },
    )
  })

  test('abre coleccion existente al hacer click en una card', async () => {
    ;(globalThis.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => coleccionesMock,
    })

    renderPage()

    await screen.findByText('Coleccion Uno')

    fireEvent.click(screen.getByRole('button', { name: /abrir colecci.*uno/i }))

    expect(mockNavigate).toHaveBeenCalledWith(
      '/user123/colecciones/collection-1/buscador',
      {
        state: { abrirModalCarga: false },
      },
    )
  })

  test('edita nombre de coleccion exitosamente', async () => {
    const user = userEvent.setup()
    ;(globalThis.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => coleccionesMock,
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ...coleccionesMock[0],
          name: 'Nuevo nombre',
        }),
      })

    renderPage()

    expect(await screen.findByText('Coleccion Uno')).toBeInTheDocument()

    const editButtons = screen.getAllByLabelText(/editar colecci/i)
    await user.click(editButtons[0])

    const input = screen.getByLabelText(/^nombre$/i)
    await user.clear(input)
    await user.type(input, 'Nuevo nombre')
    await user.click(screen.getByRole('button', { name: /guardar/i }))

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        `${API_BASE}/api/collections/collection-1`,
        expect.objectContaining({
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer fake-token',
          },
          body: JSON.stringify({
            name: 'Nuevo nombre',
          }),
        }),
      )
    })

    expect(await screen.findByText('Nuevo nombre')).toBeInTheDocument()
  })

  test('no edita si el nombre queda vacio', async () => {
    const user = userEvent.setup()
    ;(globalThis.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => coleccionesMock,
    })

    renderPage()

    expect(await screen.findByText('Coleccion Uno')).toBeInTheDocument()

    const editButtons = screen.getAllByLabelText(/editar colecci/i)
    await user.click(editButtons[0])

    const input = screen.getByLabelText(/^nombre$/i)
    await user.clear(input)

    expect(screen.getByRole('button', { name: /guardar/i })).toBeDisabled()
    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
  })

  test('muestra error si falla edicion de coleccion', async () => {
    const user = userEvent.setup()
    ;(globalThis.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => coleccionesMock,
      })
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ detail: 'No se pudo editar' }),
      })

    renderPage()

    expect(await screen.findByText('Coleccion Uno')).toBeInTheDocument()

    const editButtons = screen.getAllByLabelText(/editar colecci/i)
    await user.click(editButtons[0])

    const input = screen.getByLabelText(/^nombre$/i)
    await user.clear(input)
    await user.type(input, 'Nuevo nombre')
    await user.click(screen.getByRole('button', { name: /guardar/i }))

    expect(
      await screen.findByText(/no se pudo cambiar el nombre de la colecci/i),
    ).toBeInTheDocument()
  })

  test('elimina coleccion exitosamente', async () => {
    const user = userEvent.setup()
    ;(globalThis.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => coleccionesMock,
      })
      .mockResolvedValueOnce({
        ok: true,
        text: async () => '',
      })

    renderPage()

    expect(await screen.findByText('Coleccion Uno')).toBeInTheDocument()

    const deleteButtons = screen.getAllByLabelText(/eliminar colecci/i)
    await user.click(deleteButtons[0])
    await user.click(screen.getByRole('button', { name: /s?, eliminar/i }))

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        `${API_BASE}/api/collections/collection-1`,
        expect.objectContaining({
          method: 'DELETE',
          headers: {
            Authorization: 'Bearer fake-token',
          },
        }),
      )
    })

    expect(screen.queryByText('Coleccion Uno')).not.toBeInTheDocument()
    expect(screen.getByText('Coleccion Dos')).toBeInTheDocument()
  })

  test('no elimina coleccion si usuario cancela confirmacion', async () => {
    const user = userEvent.setup()
    ;(globalThis.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => coleccionesMock,
    })

    renderPage()

    expect(await screen.findByText('Coleccion Uno')).toBeInTheDocument()

    const deleteButtons = screen.getAllByLabelText(/eliminar colecci/i)
    await user.click(deleteButtons[0])
    await user.click(screen.getByRole('button', { name: /cancelar/i }))

    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
    expect(screen.getByText('Coleccion Uno')).toBeInTheDocument()
  })

  test('muestra error si falla eliminacion de coleccion', async () => {
    const user = userEvent.setup()
    ;(globalThis.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => coleccionesMock,
      })
      .mockResolvedValueOnce({
        ok: false,
        text: async () => JSON.stringify({ detail: 'No se pudo eliminar' }),
      })

    renderPage()

    expect(await screen.findByText('Coleccion Uno')).toBeInTheDocument()

    const deleteButtons = screen.getAllByLabelText(/eliminar colecci/i)
    await user.click(deleteButtons[0])
    await user.click(screen.getByRole('button', { name: /s?, eliminar/i }))

    expect(
      await screen.findByText(/no se pudo eliminar la colecci/i),
    ).toBeInTheDocument()
  })

  test('muestra acceso denegado si id_usuario no coincide con usuario actual', () => {
    mockParams = {
      id_usuario: 'otro-user',
    }

    renderPage()

    expect(screen.getByText('Acceso denegado')).toBeInTheDocument()
    expect(
      screen.getByText(/no tienes permiso para ver esta colecci/i),
    ).toBeInTheDocument()
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  test('renderiza todas las colecciones en el carril horizontal', async () => {
    const muchasColecciones = Array.from({ length: 6 }, (_, index) => ({
      id: `collection-${index + 1}`,
      user_id: 'user123',
      name: `Coleccion ${index + 1}`,
      description: null,
      status: 'created',
      created_at: `2024-01-0${index + 1}T00:00:00Z`,
    }))

    ;(globalThis.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => muchasColecciones,
    })

    renderPage()

    expect(await screen.findByText('Coleccion 1')).toBeInTheDocument()
    expect(screen.getByText('Coleccion 6')).toBeInTheDocument()
    expect(screen.getByText('6 Colecciones')).toBeInTheDocument()
  })

  test('capitaliza el nombre mostrado en el saludo', async () => {
    mockUser = {
      sub: 'auth0|user123',
      nickname: 'juliette',
    }
    ;(globalThis.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => coleccionesMock,
    })

    renderPage()

    expect(await screen.findByText(/Hola, Juliette!/)).toBeInTheDocument()
  })

  test('usa nickname si no existe given_name', async () => {
    mockUser = {
      sub: 'auth0|user123',
      nickname: 'antonia',
    }
    ;(globalThis.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => [],
    })

    renderPage()

    expect(
      screen.getByRole('heading', { level: 1, name: /hola, antonia/i }),
    ).toBeInTheDocument()
  })

  test('usa nickname para navegar si no existe sub', async () => {
    mockUser = {
      nickname: 'nickname-user',
      given_name: 'Anto',
    }

    mockParams = {
      id_usuario: 'nickname-user',
    }
    ;(globalThis.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => [],
    })

    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: /iniciar/i }))

    expect(mockNavigate).toHaveBeenCalledWith(
      '/nickname-user/colecciones/nueva/buscador',
      {
        state: { abrirModalCarga: true },
      },
    )
  })
})
