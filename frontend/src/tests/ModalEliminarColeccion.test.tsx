import { render, screen, fireEvent } from '@testing-library/react'
import ModalEliminarColeccion from '../components/modal_eliminar_coleccion/modal_eliminar_coleccion'

describe('ModalEliminarColeccion', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  const renderModal = ({
    isOpen = true,
    nombreColeccion = 'Mi colección',
    onConfirm = jest.fn(),
    onClose = jest.fn(),
  } = {}) => {
    render(
      <ModalEliminarColeccion
        isOpen={isOpen}
        nombreColeccion={nombreColeccion}
        onConfirm={onConfirm}
        onClose={onClose}
      />,
    )

    return { onConfirm, onClose }
  }

  test('renderiza el modal cuando isOpen es true', () => {
    renderModal()

    expect(screen.getByText('Eliminar archivo')).toBeInTheDocument()

    expect(
      screen.getByText('Esta acción no se puede deshacer.'),
    ).toBeInTheDocument()

    expect(
      screen.getByRole('button', {
        name: /cancelar/i,
      }),
    ).toBeInTheDocument()

    expect(
      screen.getByRole('button', {
        name: /sí, eliminar/i,
      }),
    ).toBeInTheDocument()
  })

  test('no renderiza nada cuando isOpen es false', () => {
    renderModal({ isOpen: false })

    expect(screen.queryByText('Eliminar archivo')).not.toBeInTheDocument()
  })

  test('muestra nombre de colección cuando existe', () => {
    renderModal({
      nombreColeccion: 'Colección importante',
    })

    expect(screen.getByText('"Colección importante"')).toBeInTheDocument()

    expect(screen.getByText(/permanentemente\?/i)).toBeInTheDocument()
  })

  test('muestra mensaje genérico cuando no hay nombreColeccion', () => {
    render(
      <ModalEliminarColeccion
        isOpen={true}
        onConfirm={jest.fn()}
        onClose={jest.fn()}
      />,
    )

    expect(
      screen.getByText(/esta colección permanentemente/i),
    ).toBeInTheDocument()
  })

  test('llama onClose al hacer click en Cancelar', () => {
    const { onClose } = renderModal()

    fireEvent.click(
      screen.getByRole('button', {
        name: /cancelar/i,
      }),
    )

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  test('llama onConfirm al hacer click en Sí, eliminar', () => {
    const { onConfirm } = renderModal()

    fireEvent.click(
      screen.getByRole('button', {
        name: /sí, eliminar/i,
      }),
    )

    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  test('llama onClose al hacer click en overlay', () => {
    const { onClose } = renderModal()

    const overlay = document.querySelector('.mea-overlay') as HTMLElement

    fireEvent.click(overlay)

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  test('NO llama onClose al hacer click dentro del modal', () => {
    const { onClose } = renderModal()

    const modalBox = document.querySelector('.mea-box') as HTMLElement

    fireEvent.click(modalBox)

    expect(onClose).not.toHaveBeenCalled()
  })

  test('renderiza el nombre de colección con clase mea-filename', () => {
    renderModal({
      nombreColeccion: 'Archivo.pdf',
    })

    const filename = document.querySelector('.mea-filename')

    expect(filename).toBeInTheDocument()
    expect(filename).toHaveTextContent('"Archivo.pdf"')
  })

  test('renderiza icono SVG de eliminar', () => {
    renderModal()

    const svg = document.querySelector('.mea-icon-svg')

    expect(svg).toBeInTheDocument()
  })

  test('no ejecuta acciones automáticamente', () => {
    const { onClose, onConfirm } = renderModal()

    expect(onClose).not.toHaveBeenCalled()
    expect(onConfirm).not.toHaveBeenCalled()
  })
})
