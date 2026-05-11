import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ModalDocumentosDisponibles from './modal_documentos_disponibles'

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

  it('lista archivos y cierra', async () => {
    const user = userEvent.setup()
    const onClose = jest.fn()
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
    const { container } = render(
      <ModalDocumentosDisponibles
        isOpen
        fuentes={[
          {
            id: '1',
            filename: 'a.pdf',
            file_type: 'pdf',
            status: 'ready',
          },
          {
            id: '2',
            filename: 'b.pdf',
            file_type: 'pdf',
            status: 'processing',
          },
        ]}
        onClose={onClose}
        darkMode
      />,
    )

    expect(screen.getByText(/a\.pdf/i)).toBeInTheDocument()
    expect(
      screen.getByText(/2 archivos en esta colección/i),
    ).toBeInTheDocument()
    await user.click(
      screen.getByText(/a\.pdf/i).closest('.mdd-card') as HTMLElement,
    )
    expect(logSpy).toHaveBeenCalledWith('Documento seleccionado:', '1')
    await user.click(container.querySelector('.mdd-close') as HTMLElement)
    expect(onClose).toHaveBeenCalled()
    logSpy.mockRestore()
  })
})
