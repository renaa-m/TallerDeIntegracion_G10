import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ModalEliminarCuenta from './modal_eliminar_cuenta'

describe('ModalEliminarCuenta', () => {
  beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('no abre el modal de borrado si está cerrado', () => {
    render(
      <ModalEliminarCuenta
        isOpen={false}
        onClose={jest.fn()}
        onConfirm={jest.fn()}
        isDeleting={false}
      />,
    )
    expect(
      screen.queryByRole('heading', { name: /borrar tu cuenta/i }),
    ).not.toBeInTheDocument()
  })

  it('renderiza en portal y confirma borrado', async () => {
    const user = userEvent.setup()
    const onConfirm = jest.fn()
    const onClose = jest.fn()
    render(
      <ModalEliminarCuenta
        isOpen
        onClose={onClose}
        onConfirm={onConfirm}
        isDeleting={false}
      />,
    )

    expect(
      screen.getByRole('heading', { name: /borrar tu cuenta/i }),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /eliminar cuenta/i }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('mientras elimina muestra texto y deshabilita botones', () => {
    render(
      <ModalEliminarCuenta
        isOpen
        onClose={jest.fn()}
        onConfirm={jest.fn()}
        isDeleting
      />,
    )
    expect(screen.getByRole('button', { name: /eliminando/i })).toBeDisabled()
    expect(
      screen.getByRole('button', { name: /mantener cuenta/i }),
    ).toBeDisabled()
  })

  it('mantener cuenta llama onClose', async () => {
    const user = userEvent.setup()
    const onClose = jest.fn()
    render(
      <ModalEliminarCuenta
        isOpen
        onClose={onClose}
        onConfirm={jest.fn()}
        isDeleting={false}
      />,
    )
    await user.click(screen.getByRole('button', { name: /mantener cuenta/i }))
    expect(onClose).toHaveBeenCalled()
  })
})
