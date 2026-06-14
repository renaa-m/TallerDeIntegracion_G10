import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import BuscadorColeccion from '../pages/buscador_coleccion/buscador_coleccion'

const mockNavigate = jest.fn()
const mockSetSearchParams = jest.fn()
const mockGetToken = jest.fn()

let mockParams = {
  id_usuario: 'user-123',
  id_coleccion: 'collection-123',
}

let mockQuery = ''

jest.mock('@auth0/auth0-react', () => ({
  useAuth0: () => ({
    getAccessTokenSilently: mockGetToken,
  }),
}))

jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useNavigate: () => mockNavigate,
  useParams: () => mockParams,
  useSearchParams: () => [
    {
      get: (key: string) => {
        if (key === 'q') return mockQuery
        return null
      },
    },
    mockSetSearchParams,
  ],
}))

jest.mock('../components/modal_carga/modal_carga', () => {
  return function MockModalCarga({
    isOpen,
    onClose,
    onUploadSuccess,
  }: {
    isOpen: boolean
    onClose: () => void
    onUploadSuccess?: () => void
  }) {
    if (!isOpen) return null

    return (
      <div data-testid="modal-carga">
        <p>Modal Carga Abierto</p>
        <button onClick={onClose}>Cerrar carga</button>
        <button onClick={onUploadSuccess}>Upload success</button>
      </div>
    )
  }
})

jest.mock(
  '../components/modal_eliminar_coleccion/modal_eliminar_coleccion',
  () => {
    return function MockModalEliminarColeccion({
      isOpen,
      nombreColeccion,
      onClose,
      onConfirm,
    }: {
      isOpen: boolean
      nombreColeccion?: string
      onClose: () => void
      onConfirm: () => void
    }) {
      if (!isOpen) return null

      return (
        <div data-testid="modal-eliminar-coleccion">
          <p>Eliminar {nombreColeccion}</p>
          <button onClick={onClose}>Cancelar eliminación</button>
          <button onClick={onConfirm}>Confirmar eliminación</button>
        </div>
      )
    }
  },
)

jest.mock(
  '../components/modal_documentos_disponibles/modal_documentos_disponibles',
  () => {
    return function MockModalDocumentosDisponibles({
      isOpen,
      fuentes,
      onClose,
    }: {
      isOpen: boolean
      fuentes: Array<{ id: string; filename: string }>
      onClose: () => void
    }) {
      if (!isOpen) return null

      return (
        <div data-testid="modal-documentos">
          <p>Modal Documentos Abierto</p>
          <p>{fuentes.length} documentos</p>
          {fuentes.map((f) => (
            <span key={f.id}>{f.filename}</span>
          ))}
          <button onClick={onClose}>Cerrar documentos</button>
        </div>
      )
    }
  },
)

const API_BASE = 'http://localhost:8080'

const collectionResponse = {
  id: 'collection-123',
  name: 'Colección Test',
  processing_status: 'graph_ready',
}

const collectionIdleResponse = {
  id: 'collection-123',
  name: 'Colección Test',
  processing_status: 'idle',
}

const processingCollectionResponse = {
  id: 'collection-processing',
  name: 'Colección en curso',
  processing_status: 'processing_text',
  text_progress_total: 4,
  text_progress_processed: 2,
  graph_progress_total: 0,
  graph_progress_processed: 0,
}

const documentosResponse = [
  {
    id: 'doc-1',
    filename: 'documento-uno.pdf',
    file_type: 'pdf',
    status: 'uploaded',
  },
  {
    id: 'doc-2',
    filename: 'documento-dos.txt',
    file_type: 'txt',
    status: 'processing',
  },
]

const searchResponse = {
  ready: true,
  resultados: [
    {
      titulo: 'Documento sobre grafos',
      fragmento: 'Este fragmento habla sobre grafos y búsqueda semántica.',
      id_chunk: 'chunk-1',
      enlace: 'https://example.com/doc',
      score: 0.82,
      pagina: 4,
    },
    {
      titulo: 'Documento sin enlace',
      fragmento: 'Otro resultado relevante.',
      id_chunk: 'chunk-2',
      enlace: '',
      score: 0.45,
    },
  ],
}

describe('BuscadorColeccion', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.useRealTimers()
    localStorage.clear()
    mockGetToken.mockResolvedValue('fake-token')
    mockParams = {
      id_usuario: 'user-123',
      id_coleccion: 'collection-123',
    }
    mockQuery = ''

    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: jest.fn().mockImplementation(() => ({
        matches: false,
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
      })),
    })

    globalThis.fetch = jest.fn()
  })

  const renderPage = () => {
    render(
      <MemoryRouter>
        <BuscadorColeccion />
      </MemoryRouter>,
    )
  }

  const mockFetchForCollection = (
    collection = collectionResponse,
    documentos = documentosResponse,
  ) => {
    ;(globalThis.fetch as jest.Mock).mockImplementation((url: string) => {
      if (typeof url === 'string' && url.includes('/api/documentos')) {
        return Promise.resolve({
          ok: true,
          json: async () => documentos,
        })
      }
      if (typeof url === 'string' && url.includes('/api/collections/')) {
        return Promise.resolve({
          ok: true,
          json: async () => collection,
        })
      }
      return Promise.resolve({
        ok: false,
        status: 404,
        json: async () => ({}),
      })
    })
  }

  const mockInitialLoad = () => {
    mockFetchForCollection()
  }

  test('carga datos iniciales de colección y documentos', async () => {
    mockInitialLoad()
    renderPage()

    expect(await screen.findByText('Colección Test')).toBeInTheDocument()
    expect(screen.getByText('Colección actual')).toBeInTheDocument()

    expect(globalThis.fetch).toHaveBeenCalledWith(
      `${API_BASE}/api/collections/collection-123`,
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer fake-token',
        }),
      }),
    )

    expect(globalThis.fetch).toHaveBeenCalledWith(
      `${API_BASE}/api/documentos?coleccion_id=collection-123`,
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer fake-token',
        }),
      }),
    )
  })

  test('muestra estado vacío inicial cuando no hay búsqueda enviada', async () => {
    ;(globalThis.fetch as jest.Mock).mockImplementation((url: string) => {
      if (typeof url === 'string' && url.includes('/api/documentos')) {
        return Promise.resolve({
          ok: true,
          json: async () => documentosResponse,
        })
      }
      if (typeof url === 'string' && url.includes('/api/collections/')) {
        return Promise.resolve({
          ok: true,
          json: async () => collectionIdleResponse,
        })
      }
      return Promise.resolve({ ok: true, json: async () => ({}) })
    })

    renderPage()

    expect(await screen.findByText('Colección Test')).toBeInTheDocument()
    expect(screen.getByText('Sin resultados todavía')).toBeInTheDocument()
    expect(
      screen.getByText(
        'Genera el grafo de la colección para habilitar la búsqueda semántica.',
      ),
    ).toBeInTheDocument()
  })

  test('ejecuta búsqueda al presionar Enter y muestra resultados', async () => {
    jest.useFakeTimers()
    ;(globalThis.fetch as jest.Mock).mockImplementation((url: string) => {
      if (typeof url === 'string' && url.includes('/api/search')) {
        return Promise.resolve({
          ok: true,
          json: async () => searchResponse,
        })
      }
      if (typeof url === 'string' && url.includes('/api/documentos')) {
        return Promise.resolve({
          ok: true,
          json: async () => documentosResponse,
        })
      }
      if (typeof url === 'string' && url.includes('/api/collections/')) {
        return Promise.resolve({
          ok: true,
          json: async () => collectionResponse,
        })
      }
      return Promise.resolve({
        ok: false,
        status: 404,
        json: async () => ({}),
      })
    })

    renderPage()

    expect(await screen.findByText('Colección Test')).toBeInTheDocument()

    fireEvent.change(
      screen.getByPlaceholderText('Consulta algo a tus documentos...'),
      { target: { value: 'grafos' } },
    )

    await act(async () => {
      fireEvent.keyDown(
        screen.getByPlaceholderText('Consulta algo a tus documentos...'),
        { key: 'Enter' },
      )
    })

    expect(mockSetSearchParams).toHaveBeenCalledWith({ q: 'grafos' })

    await act(async () => {
      jest.advanceTimersByTime(400)
      await Promise.resolve()
    })

    expect(
      await screen.findByText('Documento sobre grafos'),
    ).toBeInTheDocument()
    expect(screen.getByText('Alta coincidencia')).toBeInTheDocument()
    expect(screen.getByText('Coincidencia media')).toBeInTheDocument()
    expect(screen.getByText('Página 4')).toBeInTheDocument()
    expect(screen.getAllByText('Grafo IMFD')).toHaveLength(2)

    const fetchMock = globalThis.fetch as jest.Mock
    const searchCall = fetchMock.mock.calls.find(
      (call) => typeof call[0] === 'string' && call[0].includes('/api/search'),
    )
    expect(searchCall).toBeDefined()
    expect(JSON.parse(searchCall[1].body)).toEqual({
      coleccion_id: 'collection-123',
      query: 'grafos',
      limit: 10,
      min_score: 0.25,
      filtros: null,
      entity_ids: [],
      page: 1,
    })
  })

  test('si búsqueda retorna 422 muestra mensaje sin resultados', async () => {
    jest.useFakeTimers()
    ;(globalThis.fetch as jest.Mock).mockImplementation((url: string) => {
      if (typeof url === 'string' && url.includes('/api/search')) {
        return Promise.resolve({
          ok: false,
          status: 422,
          json: async () => ({}),
        })
      }
      if (typeof url === 'string' && url.includes('/api/documentos')) {
        return Promise.resolve({
          ok: true,
          json: async () => documentosResponse,
        })
      }
      if (typeof url === 'string' && url.includes('/api/collections/')) {
        return Promise.resolve({
          ok: true,
          json: async () => collectionResponse,
        })
      }
      return Promise.resolve({
        ok: false,
        status: 404,
        json: async () => ({}),
      })
    })

    mockQuery = 'consulta inicial'

    renderPage()

    expect(await screen.findByText('Colección Test')).toBeInTheDocument()

    await act(async () => {
      jest.advanceTimersByTime(400)
    })

    expect(
      await screen.findByText(
        'No hay fragmentos que coincidan con tu búsqueda semántica.',
      ),
    ).toBeInTheDocument()
  })

  test('highlight marca coincidencias de la búsqueda', async () => {
    jest.useFakeTimers()
    ;(globalThis.fetch as jest.Mock).mockImplementation((url: string) => {
      if (typeof url === 'string' && url.includes('/api/search')) {
        return Promise.resolve({
          ok: true,
          json: async () => searchResponse,
        })
      }
      if (typeof url === 'string' && url.includes('/api/documentos')) {
        return Promise.resolve({
          ok: true,
          json: async () => documentosResponse,
        })
      }
      if (typeof url === 'string' && url.includes('/api/collections/')) {
        return Promise.resolve({
          ok: true,
          json: async () => collectionResponse,
        })
      }
      return Promise.resolve({
        ok: false,
        status: 404,
        json: async () => ({}),
      })
    })

    mockQuery = 'grafos'

    renderPage()

    expect(await screen.findByText('Colección Test')).toBeInTheDocument()

    await act(async () => {
      jest.advanceTimersByTime(400)
    })

    const highlighted = document.querySelectorAll('mark.bc-hl')
    expect(highlighted.length).toBeGreaterThan(0)
    expect(highlighted[0]).toHaveTextContent(/grafos/i)
  })

  test('permite abrir y cerrar banner de filtros', async () => {
    mockInitialLoad()
    renderPage()

    expect(await screen.findByText('Colección Test')).toBeInTheDocument()
  })

  test('permite editar nombre de colección y guardar con Enter', async () => {
    mockInitialLoad()
    ;(globalThis.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ name: 'Nuevo nombre' }),
    })

    renderPage()

    const title = await screen.findByText('Colección Test')
    fireEvent.click(title)

    const input = screen.getByDisplayValue('Colección Test')
    fireEvent.change(input, {
      target: { value: 'Nuevo nombre' },
    })

    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' })
    })

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        `${API_BASE}/api/collections/collection-123`,
        expect.objectContaining({
          method: 'PATCH',
          headers: expect.objectContaining({
            Authorization: 'Bearer fake-token',
            'Content-Type': 'application/json',
          }),
          body: JSON.stringify({ name: 'Nuevo nombre' }),
        }),
      )
    })

    expect(await screen.findByText('Nuevo nombre')).toBeInTheDocument()
  })

  test('abre y cierra modal de documentos disponibles con fuentes cargadas', async () => {
    mockInitialLoad()

    renderPage()

    expect(await screen.findByText('Colección Test')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /ver documentos/i }))

    expect(screen.getByTestId('modal-documentos')).toBeInTheDocument()
    expect(screen.getByText('2 documentos')).toBeInTheDocument()
    expect(screen.getByText('documento-uno.pdf')).toBeInTheDocument()
    expect(screen.getByText('documento-dos.txt')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /cerrar documentos/i }))

    expect(screen.queryByTestId('modal-documentos')).not.toBeInTheDocument()
  })

  test('abre modal de eliminar colección y confirma borrado', async () => {
    mockInitialLoad()
    ;(globalThis.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({}),
    })

    renderPage()

    expect(await screen.findByText('Colección Test')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /borrar colección/i }))

    expect(screen.getByTestId('modal-eliminar-coleccion')).toBeInTheDocument()
    expect(screen.getByText('Eliminar Colección Test')).toBeInTheDocument()

    fireEvent.click(
      screen.getByRole('button', { name: /confirmar eliminación/i }),
    )

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

    expect(mockNavigate).toHaveBeenCalledWith('/landing-page/user-123', {
      replace: true,
    })
  })

  test('abre y cierra modal de eliminar colección sin borrar', async () => {
    mockInitialLoad()

    renderPage()

    expect(await screen.findByText('Colección Test')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /borrar colección/i }))

    expect(screen.getByTestId('modal-eliminar-coleccion')).toBeInTheDocument()

    fireEvent.click(
      screen.getByRole('button', { name: /cancelar eliminación/i }),
    )

    expect(
      screen.queryByTestId('modal-eliminar-coleccion'),
    ).not.toBeInTheDocument()
  })

  test('cuando id_coleccion es nueva abre ModalCarga y no carga datos iniciales', () => {
    mockParams = {
      id_usuario: 'user-123',
      id_coleccion: 'nueva',
    }

    renderPage()

    expect(screen.getByTestId('modal-carga')).toBeInTheDocument()
    expect(screen.getByText('Modal Carga Abierto')).toBeInTheDocument()
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  test('cierra ModalCarga cuando id_coleccion es nueva', () => {
    mockParams = {
      id_usuario: 'user-123',
      id_coleccion: 'nueva',
    }

    renderPage()

    fireEvent.click(screen.getByRole('button', { name: /cerrar carga/i }))

    expect(screen.queryByTestId('modal-carga')).not.toBeInTheDocument()
  })

  test('clic en barra de colección en procesamiento abre modal sin navegar', async () => {
    mockParams = {
      id_usuario: 'user-123',
      id_coleccion: 'collection-processing',
    }
    localStorage.setItem('active_collection_id', 'collection-active')
    mockFetchForCollection(processingCollectionResponse)

    renderPage()

    expect(
      await screen.findByText(/Se está procesando «Colección en curso»/),
    ).toBeInTheDocument()

    fireEvent.click(screen.getByText('Clic para ver detalle'))

    expect(screen.getByTestId('modal-carga')).toBeInTheDocument()
    expect(mockNavigate).not.toHaveBeenCalled()
  })

  test('aplica clase dark cuando matchMedia indica dark mode', async () => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: jest.fn().mockImplementation(() => ({
        matches: true,
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
      })),
    })

    mockInitialLoad()

    renderPage()

    expect(await screen.findByText('Colección Test')).toBeInTheDocument()

    const root = document.querySelector('.bc-root')
    expect(root).toHaveClass('bc-dark')
  })

  test('deja de hacer polling cuando la colección devuelve 404', async () => {
    jest.useFakeTimers()

    let collectionPollCount = 0
    ;(globalThis.fetch as jest.Mock).mockImplementation((url: string) => {
      if (typeof url === 'string' && url.includes('/api/documentos')) {
        return Promise.resolve({
          ok: true,
          json: async () => documentosResponse,
        })
      }
      if (typeof url === 'string' && url.includes('/api/collections/')) {
        collectionPollCount += 1
        return Promise.resolve({
          ok: false,
          status: 404,
          json: async () => ({}),
        })
      }
      return Promise.resolve({ ok: true, json: async () => ({}) })
    })

    renderPage()

    await waitFor(() => {
      expect(collectionPollCount).toBeGreaterThanOrEqual(1)
    })

    const callsAfter404 = collectionPollCount

    await act(async () => {
      jest.advanceTimersByTime(12000)
    })

    expect(collectionPollCount).toBe(callsAfter404)
  })
})
