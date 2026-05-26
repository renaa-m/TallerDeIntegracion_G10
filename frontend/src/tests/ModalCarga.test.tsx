import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import ModalCarga from '../components/modal_carga/modal_carga'

const mockNavigate = jest.fn()
const mockGetToken = jest.fn()

const ACTIVE_COLLECTION_KEY = 'active_collection_id'
const MODAL_ETAPA_KEY = 'modal_carga_etapa'
const API_BASE = 'http://localhost:8080'

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
    jest.useRealTimers()
    localStorage.clear()
    mockGetToken.mockResolvedValue('fake-token')
    globalThis.fetch = jest.fn()
  })

  afterEach(() => {
    jest.useRealTimers()
    localStorage.clear()
  })

  const renderModal = ({
    onClose = jest.fn(),
    onUploadSuccess,
    darkMode = false,
    isOpen = true,
  }: {
    onClose?: jest.Mock
    onUploadSuccess?: jest.Mock
    darkMode?: boolean
    isOpen?: boolean
  } = {}) => {
    render(
      <MemoryRouter>
        <ModalCarga
          isOpen={isOpen}
          onClose={onClose}
          darkMode={darkMode}
          onUploadSuccess={onUploadSuccess}
        />
      </MemoryRouter>,
    )

    return { onClose, onUploadSuccess }
  }

  const selectFileAndNameCollection = async (
    filename = 'documento.pdf',
    collectionName = 'Mi colección',
  ) => {
    const file = new File(['contenido'], filename, {
      type: 'application/pdf',
    })

    const input = document.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement
    fireEvent.change(input, { target: { files: [file] } })

    expect(await screen.findByText(filename)).toBeInTheDocument()

    fireEvent.change(screen.getByPlaceholderText('Nombre de colección'), {
      target: { value: collectionName },
    })

    return file
  }

  const uploadSuccessfullyAndGoToPipeline = async () => {
    ;(globalThis.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'collection-123' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'doc-123' }),
      })

    renderModal()

    await selectFileAndNameCollection()

    fireEvent.click(screen.getByRole('button', { name: /añadir archivos/i }))

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledTimes(2)
    })

    expect(await screen.findByText('Procesar grafo')).toBeInTheDocument()
    expect(screen.getByText('Listo para procesar')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /generar grafo/i }),
    ).toBeInTheDocument()
  }

  test('renderiza el modal cuando isOpen es true', () => {
    renderModal()

    expect(screen.getByText('Añadir fuentes')).toBeInTheDocument()
    expect(screen.getByText('Sube documentos para indexar')).toBeInTheDocument()
    expect(screen.getByText('Arrastra tus archivos aquí')).toBeInTheDocument()
    expect(screen.getByText('PDF o TXT · Máx. 50 MB')).toBeInTheDocument()
    expect(
      screen.getByPlaceholderText('Nombre de colección'),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /cancelar/i }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /añadir archivos/i }),
    ).toBeDisabled()
  })

  test('aplica modo oscuro cuando darkMode es true', () => {
    renderModal({ darkMode: true })

    const panel = document.querySelector('.mc-panel')
    expect(panel).toHaveClass('dark')
  })

  test('no renderiza nada cuando isOpen es false', () => {
    renderModal({ isOpen: false })

    expect(screen.queryByText('Añadir fuentes')).not.toBeInTheDocument()
  })

  test('muestra estado de drag y permite soltar archivo', async () => {
    renderModal()

    const dropzone = document.querySelector('.mc-dropzone') as HTMLElement
    const file = new File(['contenido'], 'arrastrado.pdf', {
      type: 'application/pdf',
    })

    fireEvent.dragOver(dropzone)
    expect(screen.getByText('Suelta los archivos')).toBeInTheDocument()

    fireEvent.drop(dropzone, {
      dataTransfer: {
        files: [file],
      },
    })

    expect(await screen.findByText('arrastrado.pdf')).toBeInTheDocument()
    expect(screen.getByText('Arrastra tus archivos aquí')).toBeInTheDocument()
  })

  test('agrega archivo seleccionado y habilita botón al escribir nombre', async () => {
    renderModal()

    await selectFileAndNameCollection('documento.pdf', '')

    const uploadButton = screen.getByRole('button', {
      name: /añadir archivos/i,
    })

    expect(uploadButton).toBeDisabled()

    fireEvent.change(screen.getByPlaceholderText('Nombre de colección'), {
      target: { value: 'Mi colección' },
    })

    expect(uploadButton).not.toBeDisabled()
  })

  test('elimina archivo de la lista', async () => {
    renderModal()

    await selectFileAndNameCollection()

    const removeButton = document.querySelector(
      '.mc-file-remove',
    ) as HTMLButtonElement
    fireEvent.click(removeButton)

    expect(screen.queryByText('documento.pdf')).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /añadir archivos/i }),
    ).toBeDisabled()
  })

  test('cancelar cierra modal, limpia estado y redirige a landing_page sin colección activa', async () => {
    const { onClose } = renderModal()

    fireEvent.click(screen.getByRole('button', { name: /cancelar/i }))

    await waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1)
    })

    expect(mockNavigate).toHaveBeenCalledWith('/landing_page')
    expect(localStorage.getItem(ACTIVE_COLLECTION_KEY)).toBeNull()
    expect(localStorage.getItem(MODAL_ETAPA_KEY)).toBeNull()
  })

  test('sube archivo creando colección y documento, guarda localStorage y pasa a pipeline', async () => {
    const onUploadSuccess = jest.fn()

    ;(globalThis.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'collection-123' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'doc-123' }),
      })

    renderModal({ onUploadSuccess })

    await selectFileAndNameCollection()

    fireEvent.click(screen.getByRole('button', { name: /añadir archivos/i }))

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledTimes(2)
    })

    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      1,
      `${API_BASE}/api/collections`,
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer fake-token',
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({
          name: 'Mi colección',
          description: '',
        }),
      }),
    )

    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      2,
      `${API_BASE}/api/documentos/upload?coleccion_id=collection-123`,
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer fake-token',
        }),
      }),
    )

    expect(localStorage.getItem(ACTIVE_COLLECTION_KEY)).toBe('collection-123')
    expect(localStorage.getItem(MODAL_ETAPA_KEY)).toBe('pipeline')
    expect(onUploadSuccess).toHaveBeenCalledTimes(1)

    expect(await screen.findByText('Procesar grafo')).toBeInTheDocument()
    expect(
      screen.getByText('Construye el grafo de conocimiento'),
    ).toBeInTheDocument()
    expect(screen.getByText('Listo para procesar')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /generar grafo/i }),
    ).toBeInTheDocument()
  })

  test('muestra error si falla la creación de colección', async () => {
    ;(globalThis.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      json: async () => ({ detail: 'Error mock de colección' }),
    })

    renderModal()

    await selectFileAndNameCollection()

    fireEvent.click(screen.getByRole('button', { name: /añadir archivos/i }))

    expect(
      await screen.findByText('Error al crear colección'),
    ).toBeInTheDocument()
    expect(screen.getByText('Añadir fuentes')).toBeInTheDocument()
  })

  test('muestra error si no se sube ningún archivo correctamente', async () => {
    ;(globalThis.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'collection-123' }),
      })
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ detail: 'Falló upload' }),
      })

    renderModal()

    await selectFileAndNameCollection()

    fireEvent.click(screen.getByRole('button', { name: /añadir archivos/i }))

    expect(
      await screen.findByText('No se subieron archivos.'),
    ).toBeInTheDocument()
    expect(screen.getByText('Añadir fuentes')).toBeInTheDocument()
  })

  test('inicia pipeline al presionar Generar grafo', async () => {
    await uploadSuccessfullyAndGoToPipeline()
    ;(globalThis.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({}),
    })

    fireEvent.click(screen.getByRole('button', { name: /generar grafo/i }))

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        `${API_BASE}/api/collections/collection-123/process`,
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer fake-token',
          }),
        }),
      )
    })

    expect(
      await screen.findByText('Extrayendo texto de los documentos...'),
    ).toBeInTheDocument()
  })

  test('muestra error si falla iniciar pipeline', async () => {
    await uploadSuccessfullyAndGoToPipeline()
    ;(globalThis.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      json: async () => ({ detail: 'Error pipeline' }),
    })

    fireEvent.click(screen.getByRole('button', { name: /generar grafo/i }))

    expect(
      await screen.findByText('Error al iniciar Wukong'),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /generar grafo/i }),
    ).toBeInTheDocument()
  })

  test('restaura colección activa desde localStorage al abrir', async () => {
    localStorage.setItem(ACTIVE_COLLECTION_KEY, 'collection-123')
    localStorage.setItem(MODAL_ETAPA_KEY, 'pipeline')
    ;(globalThis.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        processing_status: 'graph_ready',
      }),
    })

    renderModal()

    expect(await screen.findByText('Procesar grafo')).toBeInTheDocument()
    expect(
      await screen.findByText('¡Grafo generado correctamente!'),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /finalizar/i }),
    ).toBeInTheDocument()

    expect(globalThis.fetch).toHaveBeenCalledWith(
      `${API_BASE}/api/collections/collection-123`,
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer fake-token',
        }),
      }),
    )
  })

  test('Finalizar limpia localStorage, llama onClose y navega al buscador sin borrar colección', async () => {
    localStorage.setItem(ACTIVE_COLLECTION_KEY, 'collection-123')
    localStorage.setItem(MODAL_ETAPA_KEY, 'pipeline')
    ;(globalThis.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        processing_status: 'graph_ready',
      }),
    })

    const onClose = jest.fn()
    renderModal({ onClose })

    fireEvent.click(await screen.findByRole('button', { name: /finalizar/i }))

    expect(localStorage.getItem(ACTIVE_COLLECTION_KEY)).toBeNull()
    expect(localStorage.getItem(MODAL_ETAPA_KEY)).toBeNull()
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(mockNavigate).toHaveBeenCalledWith(
      '/user/colecciones/collection-123/buscador',
    )

    expect(globalThis.fetch).not.toHaveBeenCalledWith(
      `${API_BASE}/api/collections/collection-123`,
      expect.objectContaining({ method: 'DELETE' }),
    )
  })

  test('cerrar con colección activa borra colección con DELETE y redirige', async () => {
    localStorage.setItem(ACTIVE_COLLECTION_KEY, 'collection-123')
    localStorage.setItem(MODAL_ETAPA_KEY, 'pipeline')
    ;(globalThis.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          processing_status: 'idle',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({}),
      })

    const onClose = jest.fn()
    renderModal({ onClose })

    expect(await screen.findByText('Procesar grafo')).toBeInTheDocument()

    const closeButton = document.querySelector('.mc-close') as HTMLButtonElement
    fireEvent.click(closeButton)

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        `${API_BASE}/api/collections/collection-123`,
        expect.objectContaining({
          method: 'DELETE',
          headers: expect.objectContaining({
            Authorization: 'Bearer fake-token',
          }),
        }),
      )
    })

    expect(localStorage.getItem(ACTIVE_COLLECTION_KEY)).toBeNull()
    expect(localStorage.getItem(MODAL_ETAPA_KEY)).toBeNull()
    expect(mockNavigate).toHaveBeenCalledWith('/landing_page')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  test('polling actualiza estado a graph_ready y muestra Finalizar', async () => {
    jest.useFakeTimers()

    await uploadSuccessfullyAndGoToPipeline()
    ;(globalThis.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({}),
    })

    fireEvent.click(screen.getByRole('button', { name: /generar grafo/i }))

    expect(
      await screen.findByText('Extrayendo texto de los documentos...'),
    ).toBeInTheDocument()
    ;(globalThis.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        processing_status: 'graph_ready',
      }),
    })

    await act(async () => {
      jest.advanceTimersByTime(3000)
    })

    expect(
      await screen.findByText('¡Grafo generado correctamente!'),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /finalizar/i }),
    ).toBeInTheDocument()
  })

  test('polling actualiza estado a error, muestra mensaje y botón Reintentar', async () => {
    jest.useFakeTimers()

    await uploadSuccessfullyAndGoToPipeline()
    ;(globalThis.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({}),
    })

    fireEvent.click(screen.getByRole('button', { name: /generar grafo/i }))

    expect(
      await screen.findByText('Extrayendo texto de los documentos...'),
    ).toBeInTheDocument()
    ;(globalThis.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        processing_status: 'error',
        processing_error_message: 'Falló Wukong',
      }),
    })

    await act(async () => {
      jest.advanceTimersByTime(3000)
    })

    expect(
      await screen.findByText('Ocurrió un error durante el procesamiento.'),
    ).toBeInTheDocument()
    expect(screen.getByText('Falló Wukong')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /reintentar/i }),
    ).toBeInTheDocument()
  })

  test('cerrar el modal durante el procesamiento no cancela el pipeline y persiste en localStorage', async () => {
    localStorage.setItem(ACTIVE_COLLECTION_KEY, 'collection-123')
    localStorage.setItem(MODAL_ETAPA_KEY, 'pipeline')
    ;(globalThis.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        processing_status: 'processing_text',
      }),
    })

    const onClose = jest.fn()
    renderModal({ onClose })

    expect(
      await screen.findByText('Extrayendo texto de los documentos...'),
    ).toBeInTheDocument()

    const closeButton = document.querySelector('.mc-close') as HTMLButtonElement
    fireEvent.click(closeButton)

    await waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1)
    })

    expect(globalThis.fetch).not.toHaveBeenCalledWith(
      `${API_BASE}/api/collections/collection-123/process/cancel`,
      expect.anything(),
    )
    expect(localStorage.getItem(ACTIVE_COLLECTION_KEY)).toBe('collection-123')
    expect(localStorage.getItem(MODAL_ETAPA_KEY)).toBe('pipeline')
  })

  test('partial_error muestra estado de advertencia y detiene el polling', async () => {
    jest.useFakeTimers()

    await uploadSuccessfullyAndGoToPipeline()
    ;(globalThis.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({}),
    })

    fireEvent.click(screen.getByRole('button', { name: /generar grafo/i }))

    expect(
      await screen.findByText('Extrayendo texto de los documentos...'),
    ).toBeInTheDocument()
    ;(globalThis.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        processing_status: 'partial_error',
      }),
    })

    await act(async () => {
      jest.advanceTimersByTime(3000)
    })

    expect(
      await screen.findByText(
        'Procesamiento con advertencias: parte del grafo se generó; revisa el mensaje debajo.',
      ),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /generar grafo/i }),
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /finalizar/i }),
    ).toBeInTheDocument()

    const fetchCallCount = (globalThis.fetch as jest.Mock).mock.calls.length

    await act(async () => {
      jest.advanceTimersByTime(3000)
    })

    expect((globalThis.fetch as jest.Mock).mock.calls.length).toBe(fetchCallCount)
  })
})
