import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Mensaje from './mensajes_error'

describe('Mensaje', () => {
  it('muestra éxito cuando el sorteo aleatorio es favorable', async () => {
    const user = userEvent.setup()
    jest.spyOn(Math, 'random').mockReturnValue(0.9)

    render(<Mensaje />)

    await user.click(screen.getByRole('button', { name: /probar mensaje/i }))

    expect(screen.getByRole('heading', { name: /éxito/i })).toBeInTheDocument()
    expect(
      screen.getByText(/operación realizada con éxito/i),
    ).toBeInTheDocument()

    jest.restoreAllMocks()
  })

  it('muestra error cuando el sorteo aleatorio no es favorable', async () => {
    const user = userEvent.setup()
    jest.spyOn(Math, 'random').mockReturnValue(0.1)

    render(<Mensaje />)

    await user.click(screen.getByRole('button', { name: /probar mensaje/i }))

    expect(screen.getByRole('heading', { name: /error/i })).toBeInTheDocument()
    expect(
      screen.getByText(/ocurrió un error en la operación/i),
    ).toBeInTheDocument()

    jest.restoreAllMocks()
  })

  it('cierra el overlay al pulsar Cerrar', async () => {
    const user = userEvent.setup()
    jest.spyOn(Math, 'random').mockReturnValue(0.9)

    render(<Mensaje />)

    await user.click(screen.getByRole('button', { name: /probar mensaje/i }))
    await user.click(screen.getByRole('button', { name: /cerrar/i }))

    expect(
      screen.queryByRole('heading', { name: /éxito/i }),
    ).not.toBeInTheDocument()

    jest.restoreAllMocks()
  })
})
