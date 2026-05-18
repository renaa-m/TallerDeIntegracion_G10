import { render, screen, fireEvent } from '@testing-library/react'
import ModalNoDisponible from '../components/modal_no_disponible/modal_no_disponible'

describe('ModalNoDisponible', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  const renderModal = ({
    isOpen = true,
    onClose = jest.fn(),
  }: {
    isOpen?: boolean
    onClose?: jest.Mock
  } = {}) => {
    render(<ModalNoDisponible isOpen={isOpen} onClose={onClose} />)

    return { onClose }
  }

  test('renderiza el modal cuando isOpen es true', () => {
    renderModal()

    expect(screen.getByText('Próximamente')).toBeInTheDocument()
    expect(
      screen.getByText(/Esta función aún no está disponible/i),
    ).toBeInTheDocument()
    expect(screen.getByText(/Estamos trabajando en ella/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /cerrar/i })).toBeInTheDocument()
  })

  test('no renderiza nada cuando isOpen es false', () => {
    renderModal({ isOpen: false })

    expect(screen.queryByText('Próximamente')).not.toBeInTheDocument()
  })

  test('llama onClose al hacer click en el botón Cerrar', () => {
    const { onClose } = renderModal()

    fireEvent.click(screen.getByRole('button', { name: /cerrar/i }))

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  test('llama onClose al hacer click en el overlay', () => {
    const { onClose } = renderModal()

    const overlay = document.querySelector('.mnd-overlay') as HTMLElement
    fireEvent.click(overlay)

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  test('NO llama onClose al hacer click dentro del panel', () => {
    const { onClose } = renderModal()

    const panel = document.querySelector('.mnd-panel') as HTMLElement
    fireEvent.click(panel)

    expect(onClose).not.toHaveBeenCalled()
  })

  test('llama onClose al presionar Escape', () => {
    const { onClose } = renderModal()

    fireEvent.keyDown(window, {
      key: 'Escape',
      code: 'Escape',
    })

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  test('no llama onClose con una tecla distinta a Escape', () => {
    const { onClose } = renderModal()

    fireEvent.keyDown(window, {
      key: 'Enter',
      code: 'Enter',
    })

    expect(onClose).not.toHaveBeenCalled()
  })

  test('no registra cierre por Escape cuando isOpen es false', () => {
    const { onClose } = renderModal({ isOpen: false })

    fireEvent.keyDown(window, {
      key: 'Escape',
      code: 'Escape',
    })

    expect(onClose).not.toHaveBeenCalled()
  })

  test('remueve listener de Escape al desmontar', () => {
    const onClose = jest.fn()

    const { unmount } = render(
      <ModalNoDisponible isOpen={true} onClose={onClose} />,
    )

    unmount()

    fireEvent.keyDown(window, {
      key: 'Escape',
      code: 'Escape',
    })

    expect(onClose).not.toHaveBeenCalled()
  })

  test('renderiza las clases principales del modal', () => {
    renderModal()

    expect(document.querySelector('.mnd-overlay')).toBeInTheDocument()
    expect(document.querySelector('.mnd-panel')).toBeInTheDocument()
    expect(document.querySelector('.mnd-icon-area')).toBeInTheDocument()
    expect(document.querySelector('.mnd-footer')).toBeInTheDocument()
  })
})
