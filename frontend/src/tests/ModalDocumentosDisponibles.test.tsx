import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ModalDocumentosDisponibles from '../components/modal_documentos_disponibles/modal_documentos_disponibles'
import { useAuth0 } from '@auth0/auth0-react'

jest.mock('@auth0/auth0-react')

const fuentesMock = [
  {
    id: 'doc-1',
    filename: 'documento-uno.pdf',
    file_type: 'pdf',
    storage_path: 'user-123/collection-456/doc-1',
    status: 'uploaded',
  },
  {
    id: 'doc-2',
    filename: 'documento-dos.txt',
    file_type: 'txt',
    storage_path: 'user-123/collection-456/doc-2',
    status: 'processing',
  },
]

describe('ModalDocumentosDisponibles', () => {
  const mockGetAccessTokenSilently = jest.fn()

  beforeAll(() => {
    // Define window.open como una función mock de Jest
    window.open = jest.fn()
  })

  beforeEach(() => {
    jest.clearAllMocks()
    ;(useAuth0 as jest.Mock).mockReturnValue({
      getAccessTokenSilently: mockGetAccessTokenSilently,
    })
    global.window.open = jest.fn()
    global.fetch = jest.fn()
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  const renderModal = ({
    isOpen = true,
    fuentes = fuentesMock,
    onClose = jest.fn(),
  } = {}) => {
    render(
      <ModalDocumentosDisponibles
        isOpen={isOpen}
        fuentes={fuentes}
        onClose={onClose}
      />,
    )
    return { onClose }
  }

  test('renderiza el modal cuando isOpen es true', () => {
    renderModal()
    expect(screen.getByText('Documentos Disponibles')).toBeInTheDocument()
  })

  test('no renderiza nada cuando isOpen es false', () => {
    renderModal({ isOpen: false })
    expect(screen.queryByText('Documentos Disponibles')).not.toBeInTheDocument()
  })

  test('muestra mensaje vacío si no hay documentos', () => {
    renderModal({ fuentes: [] })
    expect(screen.getByText('No hay documentos cargados.')).toBeInTheDocument()
  })

  test('llama onClose al hacer click en el overlay', () => {
    const { onClose } = renderModal()
    const overlay = document.querySelector('.mdd-overlay') as HTMLElement
    fireEvent.click(overlay)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  test('llama onClose al hacer click en el botón cerrar', () => {
    const { onClose } = renderModal()
    const closeButton = document.querySelector(
      '.mdd-close',
    ) as HTMLButtonElement
    fireEvent.click(closeButton)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  test('no llama onClose al hacer click dentro del panel', () => {
    const { onClose } = renderModal()
    const panel = document.querySelector('.mdd-panel') as HTMLElement
    fireEvent.click(panel)
    expect(onClose).not.toHaveBeenCalled()
  })

  test('renderiza una tarjeta por cada documento', () => {
    renderModal()
    const cards = document.querySelectorAll('.mdd-card')
    expect(cards).toHaveLength(2)
  })

  test('renderiza loader cuando un documento está processing', () => {
    renderModal()
    const processingCard = screen
      .getByText('documento-dos.txt')
      .closest('.mdd-card') as HTMLElement
    expect(processingCard.querySelector('.mdd-spin')).toBeInTheDocument()
  })

  test('no renderiza loader cuando un documento no está processing', () => {
    renderModal()
    const uploadedCard = screen
      .getByText('documento-uno.pdf')
      .closest('.mdd-card') as HTMLElement
    expect(uploadedCard.querySelector('.mdd-spin')).not.toBeInTheDocument()
  })

  test('hace console.log al seleccionar documento', () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
    renderModal()
    const card = screen
      .getByText('documento-uno.pdf')
      .closest('.mdd-card') as HTMLElement
    fireEvent.click(card)
    expect(consoleSpy).toHaveBeenCalledWith('Seleccionado:', 'doc-1')
    consoleSpy.mockRestore()
  })

  test('obtiene URL temporal y abre el documento', async () => {
    const user = userEvent.setup()

    mockGetAccessTokenSilently.mockResolvedValue('test-token')
    ;(global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        url: 'https://example.com/signed-url?token=xyz',
        expires_at: new Date(Date.now() + 30 * 1000).toISOString(),
        expires_in_seconds: 30,
      }),
    })

    renderModal()

    const buttons = screen.getAllByRole('button', { hidden: true })
    const accessButton = buttons.find((btn) => {
      const title = btn.getAttribute('title') || ''
      const disabled = btn.getAttribute('disabled')
      return title.includes('segundos') && !disabled
    })

    if (!accessButton) {
      throw new Error('No se encontró el botón de acceso')
    }

    await user.click(accessButton)

    await waitFor(() => {
      expect(window.open).toHaveBeenCalledWith(
        'https://example.com/signed-url?token=xyz',
        '_blank',
      )
    })
  })

  test('deshabilita el botón cuando el documento está en procesamiento', () => {
    renderModal()
    const processingButton = screen.getByTitle(
      'Documento en procesamiento',
    ) as HTMLButtonElement
    expect(processingButton).toBeDisabled()
  })

  test('muestra alerta de error si falla la obtención de URL', async () => {
    const user = userEvent.setup()
    const alertSpy = jest.spyOn(window, 'alert').mockImplementation(() => {})

    mockGetAccessTokenSilently.mockResolvedValue('test-token')
    ;(global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 403,
      json: async () => ({ detail: 'Acceso denegado' }),
    })

    renderModal()

    const buttons = screen.getAllByRole('button', { hidden: true })
    const accessButton = buttons.find((btn) => {
      const title = btn.getAttribute('title') || ''
      const disabled = btn.getAttribute('disabled')
      return title.includes('segundos') && !disabled
    })

    if (accessButton) {
      await user.click(accessButton)

      await waitFor(() => {
        expect(alertSpy).toHaveBeenCalledWith(
          expect.stringContaining('No se pudo abrir el documento'),
        )
      })
    }

    alertSpy.mockRestore()
  })
})
