import { render, screen, fireEvent } from '@testing-library/react'
import ModalDocumentosDisponibles from '../components/modal_documentos_disponibles/modal_documentos_disponibles'

const fuentesMock = [
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

describe('ModalDocumentosDisponibles', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  const renderModal = ({
    isOpen = true,
    fuentes = fuentesMock,
    onClose = jest.fn(),
    darkMode = false,
  } = {}) => {
    render(
      <ModalDocumentosDisponibles
        isOpen={isOpen}
        fuentes={fuentes}
        onClose={onClose}
        darkMode={darkMode}
      />,
    )

    return { onClose }
  }

  test('renderiza el modal cuando isOpen es true', () => {
    renderModal()

    expect(screen.getByText('Documentos Disponibles')).toBeInTheDocument()
    expect(screen.getByText('2 archivos en esta colección')).toBeInTheDocument()
    expect(screen.getByText('documento-uno.pdf')).toBeInTheDocument()
    expect(screen.getByText('documento-dos.txt')).toBeInTheDocument()
  })

  test('no renderiza nada cuando isOpen es false', () => {
    renderModal({ isOpen: false })

    expect(screen.queryByText('Documentos Disponibles')).not.toBeInTheDocument()
  })

  test('muestra mensaje vacío si no hay documentos', () => {
    renderModal({ fuentes: [] })

    expect(screen.getByText('0 archivos en esta colección')).toBeInTheDocument()
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

  test('aplica clase dark cuando darkMode es true', () => {
    renderModal({ darkMode: true })

    const overlay = document.querySelector('.mdd-overlay') as HTMLElement

    expect(overlay).toHaveClass('bc-dark')
  })

  test('no aplica clase dark cuando darkMode es false', () => {
    renderModal({ darkMode: false })

    const overlay = document.querySelector('.mdd-overlay') as HTMLElement

    expect(overlay).not.toHaveClass('bc-dark')
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
})
