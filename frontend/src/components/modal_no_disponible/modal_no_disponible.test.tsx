import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ModalNoDisponible from './modal_no_disponible'

describe('ModalNoDisponible', () => {
  it('no renderiza cuando está cerrado', () => {
    const { container } = render(
      <ModalNoDisponible isOpen={false} onClose={jest.fn()} />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('muestra mensaje y cierra con el botón', async () => {
    const user = userEvent.setup()
    const onClose = jest.fn()
    render(<ModalNoDisponible isOpen onClose={onClose} />)

    expect(screen.getByText(/próximamente/i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /cerrar/i }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('cierra con Escape', async () => {
    const user = userEvent.setup()
    const onClose = jest.fn()
    render(<ModalNoDisponible isOpen onClose={onClose} />)

    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalled()
  })

  it('cierra al pulsar el overlay', async () => {
    const user = userEvent.setup()
    const onClose = jest.fn()
    const { container } = render(<ModalNoDisponible isOpen onClose={onClose} />)
    const overlay = container.querySelector('.mnd-overlay')
    expect(overlay).toBeTruthy()
    await user.click(overlay as HTMLElement)
    expect(onClose).toHaveBeenCalled()
  })
})
