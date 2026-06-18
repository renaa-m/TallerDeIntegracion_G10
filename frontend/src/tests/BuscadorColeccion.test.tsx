import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import BuscadorColeccion from '../pages/buscador_coleccion/buscador_coleccion'
import { syncThemeClass } from '../lib/theme'

const mockNavigate = jest.fn()
const mockSetSearchParams = jest.fn()
const mockGetToken = jest.fn()

let mockParams = {
  id_usuario: 'user-123',
  id_coleccion: 'collection-123',
}

let mockSearchParams = new URLSearchParams()

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
    mockSearchParams,
    (
      next:
        | URLSearchParams
        | Record<string, string>
        | ((prev: URLSearchParams) => URLSearchParams),
    ) => {
      if (typeof next === 'function') {
        mockSearchParams = next(new URLSearchParams(mockSearchParams))
      } else {
        mockSearchParams = new URLSearchParams(next)
      }
      mockSetSearchParams(next)
    },
  ],
}))

jest.mock('../components/modal_carga/modal_carga', () => {
  return function MockModalCarga({
    isOpen,
    forcePipelineEtapa,
    onClose,
    onUploadSuccess,
  }: {
    isOpen: boolean
    forcePipelineEtapa?: boolean
    onClose: () => void
    onUploadSuccess?: () => void
  }) {
    if (!isOpen) return null

    return (
      <div data-testid="modal-carga">
        <p>{forcePipelineEtapa ? 'Procesar grafo' : 'Añadir fuentes'}</p>
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
  page: 1,
  total: 34,
  total_pages: 4,
  pages: 4,
  message: null,
  resultados: [
    {
      titulo: 'Documento sobre grafos',
      fragmento: 'Este fragmento habla sobre grafos y búsqueda semántica.',
      id_chunk: 'chunk-1',
      storage_path: 'documentos/doc1.pdf',
      score: 0.82,
      pagina: 4,
    },
    {
      titulo: 'Documento sin enlace',
      fragmento: 'Otro resultado relevante.',
      id_chunk: 'chunk-2',
      storage_path: 'documentos/doc2.pdf',
      score: 0.45,
    },
  ],
  results: [
    {
      titulo: 'Documento sobre grafos',
      fragmento: 'Este fragmento habla sobre grafos y búsqueda semántica.',
      id_chunk: 'chunk-1',
      storage_path: 'documentos/doc1.pdf',
      score: 0.82,
      pagina: 4,
    },
  ],
}

describe('BuscadorColeccion', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.useRealTimers()
    localStorage.clear()
    mockSearchParams = new URLSearchParams()
    mockGetToken.mockResolvedValue('fake-token')
    mockParams = {
      id_usuario: 'user-123',
      id_coleccion: 'collection-123',
    }

    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: jest.fn().mockImplementation(() => ({
        matches: false,
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
      })),
    })

    Object.defineProperty(window, 'scrollTo', {
      writable: true,
      value: jest.fn(),
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
    expect(
      screen.getByRole('heading', { name: 'Colección Test' }),
    ).toBeInTheDocument()

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
    expect(screen.getByText('Búsqueda No Disponible Aún')).toBeInTheDocument()
    expect(
      screen.getAllByText(
        'Genera el grafo de la colección para habilitar la búsqueda semántica.',
      ).length,
    ).toBeGreaterThan(0)
  })

  test('ejecuta búsqueda al presionar Enter y muestra resultados', async () => {
    jest.useFakeTimers()
    ;(globalThis.fetch as jest.Mock).mockImplementation((url: string) => {
      if (typeof url === 'string' && url.includes('/api/search')) {
        return Promise.resolve({
          ok: true,
          status: 200,
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

    expect(mockSearchParams.get('q')).toBe('grafos')

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

    const fetchMock = globalThis.fetch as jest.Mock
    const searchCall = fetchMock.mock.calls.find(
      (call) => typeof call[0] === 'string' && call[0].includes('/api/search'),
    )
    expect(searchCall).toBeDefined()
    expect(JSON.parse(searchCall[1].body)).toEqual({
      coleccion_id: 'collection-123',
      query: 'grafos',
      min_score: 0.25,
      filtros: null,
      page: 1,
    })

    expect(screen.getByRole('button', { name: 'Anterior' })).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Siguiente' }),
    ).toBeInTheDocument()
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

    mockSearchParams = new URLSearchParams({ q: 'consulta inicial' })

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
    ;(globalThis.fetch as jest.Mock).mockImplementation(
      (url: string | URL | Request) => {
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
      },
    )

    mockSearchParams = new URLSearchParams({ q: 'grafos' })

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

  test('permite renombrar colección desde el modal', async () => {
    // Implementamos una máquina de estados quirúrgica para el fetch de este test
    ;(globalThis.fetch as jest.Mock).mockImplementation(
      (url: string | URL | Request, options?: RequestInit) => {
        if (typeof url === 'string' && url.includes('/api/documentos')) {
          return Promise.resolve({
            ok: true,
            json: async () => documentosResponse,
          })
        }
        if (typeof url === 'string' && url.includes('/api/collections/')) {
          if (options && options.method === 'PATCH') {
            return Promise.resolve({
              ok: true,
              json: async () => ({
                id: 'collection-123',
                name: 'Nuevo nombre',
                processing_status: 'graph_ready',
              }),
            })
          }
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
      },
    )

    renderPage()

    await screen.findByRole('heading', { name: 'Colección Test' })

    fireEvent.click(screen.getByRole('button', { name: /renombrar colecci/i }))

    const input = screen.getByLabelText(/^nombre$/i)
    fireEvent.change(input, { target: { value: 'Nuevo nombre' } })

    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' })
    })

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        `${API_BASE}/api/collections/collection-123`,
        expect.objectContaining({
          method: 'PATCH',
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
    // Garantizamos que las promesas iniciales se resuelvan siempre con la colección limpia
    ;(globalThis.fetch as jest.Mock).mockImplementation(
      (url: string | URL | Request, options?: RequestInit) => {
        if (typeof url === 'string' && url.includes('/api/documentos')) {
          return Promise.resolve({
            ok: true,
            json: async () => documentosResponse,
          })
        }
        if (typeof url === 'string' && url.includes('/api/collections/')) {
          if (options && options.method === 'DELETE') {
            return Promise.resolve({ ok: true, json: async () => ({}) })
          }
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
      },
    )

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
    expect(screen.getByText('Añadir fuentes')).toBeInTheDocument()
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

    expect(await screen.findByText(/Extracción de Texto/i)).toBeInTheDocument()
    expect(screen.getByText(/2 de 4 documentos/i)).toBeInTheDocument()

    fireEvent.click(screen.getByText('Ver detalle'))

    expect(screen.getByTestId('modal-carga')).toBeInTheDocument()
    expect(mockNavigate).not.toHaveBeenCalled()
  })

  test('oculta Ver Grafo mientras procesa pero mantiene Ver Documentos', async () => {
    mockParams = {
      id_usuario: 'user-123',
      id_coleccion: 'collection-processing',
    }
    mockFetchForCollection(processingCollectionResponse)

    renderPage()

    expect(await screen.findByText('Colección en curso')).toBeInTheDocument()
    expect(
      screen.queryByRole('link', { name: /ver grafo/i }),
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /ver documentos/i }),
    ).not.toBeDisabled()
  })

  test('muestra Ver Grafo cuando el grafo está listo', async () => {
    mockInitialLoad()
    renderPage()

    expect(await screen.findByText('Colección Test')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /ver grafo/i })).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /ver documentos/i }),
    ).not.toBeDisabled()
  })

  test('aplica bc-dark en html cuando matchMedia indica dark mode', async () => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: jest.fn().mockImplementation(() => ({
        matches: true,
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
      })),
    })

    syncThemeClass()
    mockInitialLoad()
    renderPage()

    expect(await screen.findByText('Colección Test')).toBeInTheDocument()

    expect(document.documentElement).toHaveClass('bc-dark')
    const root = document.querySelector('.bc-root')
    expect(root).not.toHaveClass('bc-dark')
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

    // Esperamos a que se ejecute la primera tanda de llamadas iniciales que devuelven 404
    await waitFor(() => {
      expect(collectionPollCount).toBeGreaterThanOrEqual(1)
    })

    // Avanzamos el tiempo una primera vez para absorber cualquier llamada remanente en cola
    await act(async () => {
      jest.advanceTimersByTime(6000)
    })

    // Guardamos cuántas llamadas se registraron hasta este punto
    const llamadasTrasPrimerIntervalo = (
      globalThis.fetch as jest.Mock
    ).mock.calls.filter(
      (call) =>
        typeof call[0] === 'string' && call[0].includes('/api/collections/'),
    ).length

    // Avanzamos el tiempo una SEGUNDA vez (otros 12 segundos).
    // Si el polling realmente se detuvo, este número NO puede haber aumentado.
    await act(async () => {
      jest.advanceTimersByTime(12000)
    })

    const llamadasFinales = (globalThis.fetch as jest.Mock).mock.calls.filter(
      (call) =>
        typeof call[0] === 'string' && call[0].includes('/api/collections/'),
    )

    // Verificamos que el contador se haya congelado por completo
    expect(llamadasFinales.length).toBe(llamadasTrasPrimerIntervalo)
  })

  test('flujo nueva coleccion muestra onboarding y deshabilita acciones', async () => {
    mockParams = {
      id_usuario: 'user-123',
      id_coleccion: 'nueva',
    }

    renderPage()

    expect(screen.getByText('Nueva Colección')).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: 'Nueva Colección' }),
    ).toBeInTheDocument()
    expect(screen.queryByText('Borrar Colección')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /buscar/i })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: /cerrar carga/i }))

    expect(
      await screen.findByText(/empieza subiendo documentos/i),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /añadir fuentes/i }),
    ).toBeInTheDocument()
  })

  test('nueva coleccion con procesamiento en background no muestra onboarding de subida', async () => {
    mockParams = {
      id_usuario: 'user-123',
      id_coleccion: 'nueva',
    }
    localStorage.setItem('active_collection_id', 'collection-bg')
    localStorage.setItem('modal_carga_etapa', 'pipeline')
    ;(globalThis.fetch as jest.Mock).mockImplementation((url: string) => {
      if (
        typeof url === 'string' &&
        url.includes('/api/collections/collection-bg')
      ) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: 'collection-bg',
            name: 'Dina',
            processing_status: 'processing_text',
            text_progress_total: 3,
            text_progress_processed: 0,
          }),
        })
      }
      return Promise.resolve({ ok: true, json: async () => ({}) })
    })

    renderPage()

    fireEvent.click(screen.getByRole('button', { name: /cerrar carga/i }))

    expect(await screen.findByText(/Extracción de Texto/i)).toBeInTheDocument()
    expect(
      screen.queryByText(/empieza subiendo documentos/i),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /añadir fuentes/i }),
    ).not.toBeInTheDocument()
    expect(screen.getByText(/preparando tu colección/i)).toBeInTheDocument()
  })

  test('mantiene buscador con banner de grafo pendiente al recargar (sin reabrir modal)', async () => {
    localStorage.setItem('active_collection_id', 'collection-123')
    localStorage.setItem('modal_carga_etapa', 'pipeline')
    ;(globalThis.fetch as jest.Mock).mockImplementation((url: string) => {
      if (
        typeof url === 'string' &&
        url.includes('/api/collections/collection-123')
      ) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: 'collection-123',
            name: 'Circular DINA',
            processing_status: 'idle',
          }),
        })
      }
      if (
        typeof url === 'string' &&
        url.includes('/api/documentos?coleccion_id=collection-123')
      ) {
        return Promise.resolve({
          ok: true,
          json: async () => [{ id: 'doc-1', filename: 'a.pdf' }],
        })
      }
      if (typeof url === 'string' && url.includes('/api/search')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            resultados: [],
            total: 0,
            total_pages: 0,
            tiempo_segundos: 0,
          }),
        })
      }
      return Promise.resolve({ ok: true, json: async () => ({}) })
    })

    renderPage()

    expect(await screen.findByText('Grafo Pendiente')).toBeInTheDocument()
    expect(screen.getByText('Generar grafo')).toBeInTheDocument()
    expect(screen.queryByTestId('modal-carga')).not.toBeInTheDocument()
  })

  test('restaura modal al recargar si el usuario lo tenía abierto', async () => {
    localStorage.setItem('active_collection_id', 'collection-123')
    localStorage.setItem('modal_carga_etapa', 'pipeline')
    localStorage.setItem('modal_carga_open', '1')
    ;(globalThis.fetch as jest.Mock).mockImplementation((url: string) => {
      if (
        typeof url === 'string' &&
        url.includes('/api/collections/collection-123')
      ) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: 'collection-123',
            name: 'Circular DINA',
            processing_status: 'idle',
          }),
        })
      }
      if (
        typeof url === 'string' &&
        url.includes('/api/documentos?coleccion_id=collection-123')
      ) {
        return Promise.resolve({
          ok: true,
          json: async () => [{ id: 'doc-1', filename: 'a.pdf' }],
        })
      }
      if (typeof url === 'string' && url.includes('/api/search')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            resultados: [],
            total: 0,
            total_pages: 0,
            tiempo_segundos: 0,
          }),
        })
      }
      return Promise.resolve({ ok: true, json: async () => ({}) })
    })

    renderPage()

    expect(await screen.findByText('Procesar grafo')).toBeInTheDocument()
    expect(screen.getByTestId('modal-carga')).toBeInTheDocument()
  })

  test('no reabre modal al recargar si estaba cerrado durante extracción', async () => {
    localStorage.setItem('active_collection_id', 'collection-123')
    localStorage.setItem('modal_carga_etapa', 'pipeline')
    ;(globalThis.fetch as jest.Mock).mockImplementation((url: string) => {
      if (
        typeof url === 'string' &&
        url.includes('/api/collections/collection-123')
      ) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: 'collection-123',
            name: 'Circular DINA',
            processing_status: 'processing_text',
            text_progress_total: 4,
            text_progress_processed: 1,
          }),
        })
      }
      if (
        typeof url === 'string' &&
        url.includes('/api/documentos?coleccion_id=collection-123')
      ) {
        return Promise.resolve({
          ok: true,
          json: async () => [{ id: 'doc-1', filename: 'a.pdf' }],
        })
      }
      if (typeof url === 'string' && url.includes('/api/search')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            resultados: [],
            total: 0,
            total_pages: 0,
            tiempo_segundos: 0,
          }),
        })
      }
      return Promise.resolve({ ok: true, json: async () => ({}) })
    })

    renderPage()

    expect(await screen.findByText(/Extracción de Texto/i)).toBeInTheDocument()
    expect(screen.queryByTestId('modal-carga')).not.toBeInTheDocument()
    expect(screen.queryByText('Procesar grafo')).not.toBeInTheDocument()
  })

  test('mantiene buscador con banner de construcción del grafo al recargar (sin reabrir modal)', async () => {
    localStorage.setItem('active_collection_id', 'collection-123')
    localStorage.setItem('modal_carga_etapa', 'pipeline')
    ;(globalThis.fetch as jest.Mock).mockImplementation((url: string) => {
      if (
        typeof url === 'string' &&
        url.includes('/api/collections/collection-123')
      ) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: 'collection-123',
            name: 'Circular DINA',
            processing_status: 'processing_graph',
            graph_progress_total: 1,
            graph_progress_processed: 0,
          }),
        })
      }
      if (
        typeof url === 'string' &&
        url.includes('/api/documentos?coleccion_id=collection-123')
      ) {
        return Promise.resolve({
          ok: true,
          json: async () => [{ id: 'doc-1', filename: 'a.pdf' }],
        })
      }
      if (typeof url === 'string' && url.includes('/api/search')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            resultados: [],
            total: 0,
            total_pages: 0,
            tiempo_segundos: 0,
          }),
        })
      }
      return Promise.resolve({ ok: true, json: async () => ({}) })
    })

    renderPage()

    expect(
      await screen.findByText('Construcción del Grafo'),
    ).toBeInTheDocument()
    expect(screen.getByText('Ver detalle')).toBeInTheDocument()
    expect(screen.queryByTestId('modal-carga')).not.toBeInTheDocument()
  })

  test('restaura filtros de entidades desde la URL al recargar', async () => {
    mockSearchParams = new URLSearchParams({
      q: 'consulta entidades',
      entities: 'Persona,Organizacion',
      entity_logic: 'AND',
      entity_type: 'Persona',
    })
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
      if (
        typeof url === 'string' &&
        url.includes('/api/collections/collection-123/entities')
      ) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            tipos: ['Persona', 'Organizacion'],
            entidades: [
              { id: '1', label: 'Persona', tipo: 'Persona' },
              { id: '2', label: 'Organizacion', tipo: 'Organizacion' },
            ],
          }),
        })
      }
      if (typeof url === 'string' && url.includes('/api/collections/')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: 'collection-123',
            name: 'Colección Test',
            processing_status: 'graph_ready',
          }),
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

    fireEvent.click(
      screen.getByRole('button', { name: /criterios de búsqueda/i }),
    )

    expect(await screen.findByText('Seleccionadas (2)')).toBeInTheDocument()

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        `${API_BASE}/api/search`,
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining(
            '"nombres_entidades":["Persona","Organizacion"]',
          ),
        }),
      )
    })

    const searchCall = (globalThis.fetch as jest.Mock).mock.calls.find(
      ([url, options]) =>
        typeof url === 'string' &&
        url.includes('/api/search') &&
        typeof options?.body === 'string' &&
        options.body.includes('"logica_entidades":"AND"'),
    )
    expect(searchCall).toBeDefined()
  })
})
