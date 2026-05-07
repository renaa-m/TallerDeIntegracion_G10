import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import ModalCarga from '../components/modal_carga/modal_carga'

const mockNavigate = jest.fn()
const mockGetToken = jest.fn()

jest.mock('@auth0/auth0-react', () => ({
    useAuth0: () => ({
        getAccessTokenSilently: mockGetToken,
    }),
    }))

    jest.mock('react-router-dom', () => ({
    ...jest.requireActual('react-router-dom'),
    useNavigate: () => mockNavigate,
    }))

    describe('ModalCarga', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        mockGetToken.mockResolvedValue('fake-token')
        globalThis.fetch = jest.fn()
    })

    const renderModal = (onClose = jest.fn()) => {
        render(
        <MemoryRouter>
            <ModalCarga isOpen={true} onClose={onClose} coleccionId="collection-1" />
        </MemoryRouter>,
        )
        return { onClose }
    }

    test('renderiza el modal cuando isOpen es true', () => {
        renderModal()

        expect(screen.getByText('Añadir fuentes')).toBeInTheDocument()
        expect(screen.getByText('Seleccionar archivos')).toBeInTheDocument()
        expect(screen.getByPlaceholderText('Nombre de colección')).toBeInTheDocument()
    })

    test('no renderiza nada cuando isOpen es false', () => {
        render(
        <MemoryRouter>
            <ModalCarga isOpen={false} onClose={jest.fn()} coleccionId="collection-1" />
        </MemoryRouter>,
        )

        expect(screen.queryByText('Añadir fuentes')).not.toBeInTheDocument()
    })

    test('agrega archivo seleccionado y habilita botón al escribir nombre', async () => {
        renderModal()

        const file = new File(['contenido'], 'documento.pdf', {
        type: 'application/pdf',
        })

        const input = document.querySelector('input[type="file"]') as HTMLInputElement
        fireEvent.change(input, { target: { files: [file] } })

        expect(await screen.findByText('documento.pdf')).toBeInTheDocument()
        expect(screen.getByText('9 B')).toBeInTheDocument()

        const uploadButton = screen.getByRole('button', {
        name: /añadir 1 archivo/i,
        })

        expect(uploadButton).toBeDisabled()

        fireEvent.change(screen.getByPlaceholderText('Nombre de colección'), {
        target: { value: 'Mi colección' },
        })

        expect(uploadButton).not.toBeDisabled()
    })

    test('elimina archivo de la lista', async () => {
        renderModal()

        const file = new File(['contenido'], 'documento.pdf', {
        type: 'application/pdf',
        })

        const input = document.querySelector('input[type="file"]') as HTMLInputElement
        fireEvent.change(input, { target: { files: [file] } })

        expect(await screen.findByText('documento.pdf')).toBeInTheDocument()

        const removeButton = document.querySelector('.mc-file-remove') as HTMLButtonElement
        fireEvent.click(removeButton)

        expect(screen.queryByText('documento.pdf')).not.toBeInTheDocument()
    })

    test('cancelar cierra modal y redirige a landing_page', () => {
        const { onClose } = renderModal()

        fireEvent.click(screen.getByRole('button', { name: /cancelar/i }))

        expect(onClose).toHaveBeenCalledTimes(1)
        expect(mockNavigate).toHaveBeenCalledWith('/landing_page')
    })

    test('sube archivo creando colección y documento', async () => {
        jest.useFakeTimers()

        const collectionResponse = {
        id: 'collection-123',
        user_id: 'auth0|testuser123',
        name: 'Mi colección',
        description: '',
        status: 'created',
        created_at: '2024-01-01T00:00:00+00:00',
        }

        const documentResponse = {
        id: 'doc-123',
        user_id: 'auth0|testuser123',
        collection_id: 'collection-123',
        filename: 'documento.pdf',
        file_type: 'pdf',
        file_size_bytes: 9,
        storage_path: 'auth0_testuser123/collection-123/doc-123',
        status: 'uploaded',
        error_message: null,
        created_at: '2024-01-01T00:00:00+00:00',
        }

        ;(globalThis.fetch as jest.Mock)
        .mockResolvedValueOnce({
            ok: true,
            text: async () => JSON.stringify(collectionResponse),
        })
        .mockResolvedValueOnce({
            ok: true,
            text: async () => JSON.stringify(documentResponse),
        })

        renderModal()

        const file = new File(['contenido'], 'documento.pdf', {
        type: 'application/pdf',
        })

        const input = document.querySelector('input[type="file"]') as HTMLInputElement
        fireEvent.change(input, { target: { files: [file] } })

        fireEvent.change(screen.getByPlaceholderText('Nombre de colección'), {
        target: { value: 'Mi colección' },
        })

        fireEvent.click(
        await screen.findByRole('button', {
            name: /añadir 1 archivo/i,
        }),
        )

        await waitFor(() => {
        expect(globalThis.fetch).toHaveBeenCalledTimes(2)
        })

        expect(globalThis.fetch).toHaveBeenNthCalledWith(
        1,
        'http://localhost:8000/api/collections',
        expect.objectContaining({
            method: 'POST',
        }),
        )

        expect(globalThis.fetch).toHaveBeenNthCalledWith(
        2,
        'http://localhost:8000/api/documentos/upload?coleccion_id=collection-123',
        expect.objectContaining({
            method: 'POST',
        }),
        )

        expect(
        await screen.findByText('Colección creada y archivos subidos correctamente.'),
        ).toBeInTheDocument()

        jest.runAllTimers()

        expect(mockNavigate).toHaveBeenCalledWith(
        '/testuser123/colecciones/collection-123/buscador',
        )

        jest.useRealTimers()
    })

    test('muestra error si falla la creación de colección', async () => {
        ;(globalThis.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        text: async () => JSON.stringify({ detail: 'Error mock de colección' }),
        })

        renderModal()

        const file = new File(['contenido'], 'documento.pdf', {
        type: 'application/pdf',
        })

        const input = document.querySelector('input[type="file"]') as HTMLInputElement
        fireEvent.change(input, { target: { files: [file] } })

        fireEvent.change(screen.getByPlaceholderText('Nombre de colección'), {
        target: { value: 'Mi colección' },
        })

        fireEvent.click(
        await screen.findByRole('button', {
            name: /añadir 1 archivo/i,
        }),
        )

        expect(await screen.findByText('Error mock de colección')).toBeInTheDocument()
  })
})