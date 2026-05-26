import { render, screen, fireEvent } from '@testing-library/react'
import ModalEliminarCuenta from '../components/modal_eliminar_cuenta/modal_eliminar_cuenta'

describe('ModalEliminarCuenta', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  const renderModal = ({
    isOpen = true,
    onClose = jest.fn(),
    onConfirm = jest.fn(),
    isDeleting = false,
  } = {}) => {
    render(
      <ModalEliminarCuenta
        isOpen={isOpen}
        onClose={onClose}
        onConfirm={onConfirm}
        isDeleting={isDeleting}
      />,
    )

    return { onClose, onConfirm }
  }

  test('renderiza el modal cuando isOpen es true', () => {
    renderModal()

    expect(screen.getByText('¿Borrar tu cuenta?')).toBeInTheDocument()

    expect(
      screen.getByText(
        'Estás a punto de eliminar tu acceso y todos tus datos.',
      ),
    ).toBeInTheDocument()

    expect(screen.getByText('ESTA ACCIÓN ES PERMANENTE')).toBeInTheDocument()

    expect(
      screen.getByRole('button', {
        name: /mantener cuenta/i,
      }),
    ).toBeInTheDocument()

    expect(
      screen.getByRole('button', {
        name: /eliminar cuenta/i,
      }),
    ).toBeInTheDocument()
  })

  test('no renderiza nada cuando isOpen es false', () => {
    renderModal({ isOpen: false })

    expect(screen.queryByText('¿Borrar tu cuenta?')).not.toBeInTheDocument()
  })

  test('llama onClose al hacer click en Mantener cuenta', () => {
    const { onClose } = renderModal()

    fireEvent.click(
      screen.getByRole('button', {
        name: /mantener cuenta/i,
      }),
    )

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  test('llama onConfirm al hacer click en Eliminar cuenta', () => {
    const { onConfirm } = renderModal()

    fireEvent.click(
      screen.getByRole('button', {
        name: /eliminar cuenta/i,
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

  test('deshabilita botones cuando isDeleting es true', () => {
    renderModal({ isDeleting: true })

    const cancelButton = screen.getByRole('button', {
      name: /mantener cuenta/i,
    })

    const confirmButton = screen.getByRole('button', {
      name: /eliminando/i,
    })

    expect(cancelButton).toBeDisabled()
    expect(confirmButton).toBeDisabled()
  })

  test('muestra texto Eliminando... cuando isDeleting es true', () => {
    renderModal({ isDeleting: true })

    expect(
      screen.getByRole('button', {
        name: /eliminando/i,
      }),
    ).toBeInTheDocument()

    expect(
      screen.queryByRole('button', {
        name: /eliminar cuenta/i,
      }),
    ).not.toBeInTheDocument()
  })

  test('renderiza el modal usando portal en document.body', () => {
    renderModal()

    const overlay = document.body.querySelector('.mea-overlay')

    expect(overlay).toBeInTheDocument()
  })

  test('no ejecuta acciones múltiples automáticamente', () => {
    const { onClose, onConfirm } = renderModal()

    expect(onClose).not.toHaveBeenCalled()
    expect(onConfirm).not.toHaveBeenCalled()
  })
})
