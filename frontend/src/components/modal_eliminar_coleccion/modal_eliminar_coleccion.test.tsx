import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ModalEliminarColeccion from './modal_eliminar_coleccion'

describe('ModalEliminarColeccion', () => {
  it('no renderiza si isOpen es false', () => {
    const { container } = render(
      <ModalEliminarColeccion
        isOpen={false}
        onConfirm={jest.fn()}
        onClose={jest.fn()}
      />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('muestra nombre de colección y confirma', async () => {
    const user = userEvent.setup()
    const onConfirm = jest.fn()
    const onClose = jest.fn()
    render(
      <ModalEliminarColeccion
        isOpen
        nombreColeccion="Mi colección"
        onConfirm={onConfirm}
        onClose={onClose}
      />,
    )

    expect(screen.getByText(/mi colección/i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /sí, eliminar/i }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('texto genérico si no hay nombre', () => {
    render(
      <ModalEliminarColeccion
        isOpen
        onConfirm={jest.fn()}
        onClose={jest.fn()}
      />,
    )
    expect(
      screen.getByText(/esta colección permanentemente/i),
    ).toBeInTheDocument()
  })

  it('cancelar llama onClose', async () => {
    const user = userEvent.setup()
    const onClose = jest.fn()
    render(
      <ModalEliminarColeccion
        isOpen
        nombreColeccion="X"
        onConfirm={jest.fn()}
        onClose={onClose}
      />,
    )
    await user.click(screen.getByRole('button', { name: /cancelar/i }))
    expect(onClose).toHaveBeenCalled()
  })
})
