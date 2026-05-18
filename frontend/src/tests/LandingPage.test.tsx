import { render, screen, fireEvent, waitFor } from '@testing-library/react'
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

    jest.mock('@auth0/auth0-react', () => ({
    useAuth0: () => ({
        user: mockUser,
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
        name: 'Colección Uno',
        description: null,
        status: 'created',
        created_at: '2024-01-01T00:00:00Z',
    },
    {
        id: 'collection-2',
        user_id: 'user123',
        name: 'Colección Dos',
        description: null,
        status: 'created',
        created_at: '2024-01-02T00:00:00Z',
    },
    ]

    describe('LandingPage', () => {
    beforeEach(() => {
        jest.clearAllMocks()

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

        window.prompt = jest.fn()
        window.confirm = jest.fn()
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

        expect(screen.getByText('¡Hola, Anto!')).toBeInTheDocument()
        expect(screen.getByText('Cargando colecciones...')).toBeInTheDocument()

        expect(await screen.findByText('Colección Uno')).toBeInTheDocument()
        expect(screen.getByText('Colección Dos')).toBeInTheDocument()

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

        expect(await screen.findByText('No tienes colecciones todavía.')).toBeInTheDocument()
    })

    test('muestra error si falla la carga de colecciones', async () => {
        ;(globalThis.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        json: async () => ({ detail: 'Error backend' }),
        })

        renderPage()

        expect(await screen.findByText('Error')).toBeInTheDocument()
        expect(screen.getByText('No se pudieron cargar las colecciones')).toBeInTheDocument()
    })

    test('cierra popup de error', async () => {
        ;(globalThis.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        json: async () => ({ detail: 'Error backend' }),
        })

        renderPage()

        expect(await screen.findByText('No se pudieron cargar las colecciones')).toBeInTheDocument()

        fireEvent.click(screen.getByRole('button', { name: /cerrar/i }))

        expect(screen.queryByText('No se pudieron cargar las colecciones')).not.toBeInTheDocument()
    })

    test('navega a nueva colección al presionar Iniciar', async () => {
        ;(globalThis.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => [],
        })

        renderPage()

        fireEvent.click(screen.getByRole('button', { name: /iniciar/i }))

        expect(mockNavigate).toHaveBeenCalledWith(
        '/user123/colecciones/nueva/buscador',
        {
            state: { abrirModalCarga: true },
        },
        )
    })

    test('abre colección existente al hacer click en una card', async () => {
        ;(globalThis.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => coleccionesMock,
        })

        renderPage()

        const card = await screen.findByText('Colección Uno')

        fireEvent.click(card.closest('.card') as HTMLElement)

        expect(mockNavigate).toHaveBeenCalledWith(
        '/user123/colecciones/collection-1/buscador',
        {
            state: { abrirModalCarga: false },
        },
        )
    })

    test('edita nombre de colección exitosamente', async () => {
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

        ;(window.prompt as jest.Mock).mockReturnValueOnce('Nuevo nombre')

        renderPage()

        expect(await screen.findByText('Colección Uno')).toBeInTheDocument()

        const editButtons = screen.getAllByLabelText('Editar colección')
        fireEvent.click(editButtons[0])

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

    test('no edita si prompt retorna vacío', async () => {
        ;(globalThis.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => coleccionesMock,
        })

        ;(window.prompt as jest.Mock).mockReturnValueOnce('')

        renderPage()

        expect(await screen.findByText('Colección Uno')).toBeInTheDocument()

        const editButtons = screen.getAllByLabelText('Editar colección')
        fireEvent.click(editButtons[0])

        expect(globalThis.fetch).toHaveBeenCalledTimes(1)
    })

    test('muestra error si falla edición de colección', async () => {
        ;(globalThis.fetch as jest.Mock)
        .mockResolvedValueOnce({
            ok: true,
            json: async () => coleccionesMock,
        })
        .mockResolvedValueOnce({
            ok: false,
            json: async () => ({ detail: 'No se pudo editar' }),
        })

        ;(window.prompt as jest.Mock).mockReturnValueOnce('Nuevo nombre')

        renderPage()

        expect(await screen.findByText('Colección Uno')).toBeInTheDocument()

        const editButtons = screen.getAllByLabelText('Editar colección')
        fireEvent.click(editButtons[0])

        expect(await screen.findByText('No se pudo cambiar el nombre de la colección')).toBeInTheDocument()
    })

    test('elimina colección exitosamente', async () => {
        ;(globalThis.fetch as jest.Mock)
        .mockResolvedValueOnce({
            ok: true,
            json: async () => coleccionesMock,
        })
        .mockResolvedValueOnce({
            ok: true,
            text: async () => '',
        })

        ;(window.confirm as jest.Mock).mockReturnValueOnce(true)

        renderPage()

        expect(await screen.findByText('Colección Uno')).toBeInTheDocument()

        const deleteButtons = screen.getAllByLabelText('Eliminar colección')
        fireEvent.click(deleteButtons[0])

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

        expect(screen.queryByText('Colección Uno')).not.toBeInTheDocument()
        expect(screen.getByText('Colección Dos')).toBeInTheDocument()
    })

    test('no elimina colección si usuario cancela confirm', async () => {
        ;(globalThis.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => coleccionesMock,
        })

        ;(window.confirm as jest.Mock).mockReturnValueOnce(false)

        renderPage()

        expect(await screen.findByText('Colección Uno')).toBeInTheDocument()

        const deleteButtons = screen.getAllByLabelText('Eliminar colección')
        fireEvent.click(deleteButtons[0])

        expect(globalThis.fetch).toHaveBeenCalledTimes(1)
        expect(screen.getByText('Colección Uno')).toBeInTheDocument()
    })

    test('muestra error si falla eliminación de colección', async () => {
        ;(globalThis.fetch as jest.Mock)
        .mockResolvedValueOnce({
            ok: true,
            json: async () => coleccionesMock,
        })
        .mockResolvedValueOnce({
            ok: false,
            text: async () => JSON.stringify({ detail: 'No se pudo eliminar' }),
        })

        ;(window.confirm as jest.Mock).mockReturnValueOnce(true)

        renderPage()

        expect(await screen.findByText('Colección Uno')).toBeInTheDocument()

        const deleteButtons = screen.getAllByLabelText('Eliminar colección')
        fireEvent.click(deleteButtons[0])

        expect(await screen.findByText('No se pudo eliminar la colección')).toBeInTheDocument()
    })

    test('muestra acceso denegado si id_usuario no coincide con usuario actual', () => {
        mockParams = {
        id_usuario: 'otro-user',
        }

        renderPage()

        expect(screen.getByText('Acceso denegado')).toBeInTheDocument()
        expect(screen.getByText('No tienes permiso para ver esta colección.')).toBeInTheDocument()
        expect(globalThis.fetch).not.toHaveBeenCalled()
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

        expect(screen.getByText('¡Hola, antonia!')).toBeInTheDocument()
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

        fireEvent.click(screen.getByRole('button', { name: /iniciar/i }))

        expect(mockNavigate).toHaveBeenCalledWith(
        '/nickname-user/colecciones/nueva/buscador',
        {
            state: { abrirModalCarga: true },
        },
        )
    })
})