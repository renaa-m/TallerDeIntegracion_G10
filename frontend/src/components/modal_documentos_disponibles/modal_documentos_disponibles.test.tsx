import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ModalDocumentosDisponibles from './modal_documentos_disponibles'

jest.mock('@auth0/auth0-react', () => ({
  useAuth0: () => ({
    getAccessTokenSilently: jest.fn(),
  }),
}))

describe('ModalDocumentosDisponibles', () => {
  it('no renderiza si está cerrado', () => {
    const { container } = render(
      <ModalDocumentosDisponibles
        isOpen={false}
        fuentes={[]}
        onClose={jest.fn()}
      />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('lista vacía muestra mensaje', () => {
    render(
      <ModalDocumentosDisponibles isOpen fuentes={[]} onClose={jest.fn()} />,
    )
    expect(screen.getByText(/no hay documentos cargados/i)).toBeInTheDocument()
    expect(
      screen.getByText(/0 archivos en esta colección/i),
    ).toBeInTheDocument()
  })

  it('lista archivos, abre el documento con la URL y cierra el modal', async () => {
    const user = userEvent.setup()
    const onClose = jest.fn()
    const originalOpen = window.open
    window.open = jest.fn()

    const { container } = render(
      <ModalDocumentosDisponibles
        isOpen
        fuentes={[
          {
            id: '1',
            filename: 'a.pdf',
            file_type: 'pdf',
            status: 'ready',
            url: 'https://example.com/a.pdf',
          },
          {
            id: '2',
            filename: 'b.pdf',
            file_type: 'pdf',
            status: 'processing',
          },
        ]}
        onClose={onClose}
      />,
    )

    expect(screen.getByText(/a\.pdf/i)).toBeInTheDocument()
    expect(
      screen.getByText(/2 archivos en esta colección/i),
    ).toBeInTheDocument()

    const accessButton = screen.getByRole('button', {
      name: /Acceder al documento/i,
    })
    expect(accessButton).toBeInTheDocument()
    expect(accessButton).not.toBeDisabled()

    await user.click(accessButton)
    expect(window.open).toHaveBeenCalledWith(
      'https://example.com/a.pdf',
      '_blank',
    )

    await user.click(container.querySelector('.mdd-close') as HTMLElement)
    expect(onClose).toHaveBeenCalled()
    window.open = originalOpen
  })

  it('no abre pestaña vacía cuando el documento está en procesamiento', async () => {
    const user = userEvent.setup()
    const openSpy = jest.spyOn(window, 'open').mockImplementation(() => null)

    render(
      <ModalDocumentosDisponibles
        isOpen
        fuentes={[
          {
            id: '2',
            filename: 'b.pdf',
            file_type: 'pdf',
            status: 'processing',
          },
        ]}
        onClose={jest.fn()}
      />,
    )

    const disabledButton = screen.getByRole('button', {
      name: /URL no disponible/i,
    })
    expect(disabledButton).toBeDisabled()

    await user.click(disabledButton)
    expect(openSpy).not.toHaveBeenCalled()
    openSpy.mockRestore()
  })
})
