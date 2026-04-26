import './landing_page.css'
import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom' // Importar para capturar el :id_usuario y navegar
import { useAuth0 } from '@auth0/auth0-react' // Para validar contra el usuario real

function LandingPage() {
  const { id_usuario } = useParams<{ id_usuario: string }>() // Captura el parámetro de la URL
  const { user } = useAuth0() // Obtenemos la info del usuario logueado

  const [estado, setEstado] = useState<
    'idle' | 'loading' | 'success' | 'error'
  >('idle')
  const [mensaje, setMensaje] = useState('')

  // Opcional: Validación de seguridad
  // Extraemos el ID real del token para comparar con la URL
  const currentUserId = user?.sub?.split('|')[1] || user?.nickname
  const navigate = useNavigate()
  const coleccionesMock = [
    { id: 1, nombre: 'Colección 1', archivos: 12 },
    { id: 2, nombre: 'Colección 2', archivos: 8 },
    { id: 3, nombre: 'Colección 3', archivos: 21 },
  ]

  const handleIniciar = () => {
      const nuevaColeccionMockId = 'nueva'
      navigate(
        `/${id_usuario || currentUserId}/colecciones/${nuevaColeccionMockId}/buscador`,
        {
          state: { abrirModalCarga: true },
        },
      )
  }

  const abrirColeccionExistente = (idColeccion: number) => {
    navigate(`/${id_usuario || currentUserId}/colecciones/${idColeccion}/buscador`, {
      state: { abrirModalCarga: false },
    })
  }

  const cerrarPopup = () => {
    setEstado('idle')
    setMensaje('')
  }

  // Si alguien intenta entrar a un ID que no es el suyo, podrías bloquearlo aquí
  if (id_usuario !== currentUserId) {
    return (
      <main className="container">
        <section className="welcome">
          <h1 className="title">Acceso denegado</h1>
          <p className="subtitle">No tienes permiso para ver esta colección.</p>
        </section>
      </main>
    )
  }

  return (
    <>
      <main className="container">
        <section className="welcome">
          <span className="badge">Bienvenida</span>

          <h1 className="title">
            ¡Hola, {user?.given_name || user?.nickname}!
          </h1>

          <p className="subtitle">
            Crea tu primera colección y empieza a reunir todo lo importante en
            un solo lugar.
          </p>

          <button className="primary-btn" onClick={handleIniciar}>
            Iniciar
          </button>
        </section>

        <section className="collections">
          <h2 className="collections-title">Colecciones anteriores</h2>

          <div className="grid">
            {coleccionesMock.map((coleccion) => (
              <button
                key={coleccion.id}
                type="button"
                className="card"
                onClick={() => abrirColeccionExistente(coleccion.id)}
                style={{ cursor: 'pointer', textAlign: 'left' }}
              >
                <h3>{coleccion.nombre}</h3>
                <p>{coleccion.archivos} archivos</p>
              </button>
            ))}
          </div>
        </section>
      </main>

      {estado !== 'idle' && (
        <div className="popup-overlay">
          <div className={`popup-box popup-${estado}`}>
            <h3 className="popup-title">
              {estado === 'loading' && 'Procesando'}
              {estado === 'success' && 'Éxito'}
              {estado === 'error' && 'Error'}
            </h3>

            <p className="popup-message">{mensaje}</p>

            {estado === 'loading' ? (
              <div className="spinner"></div>
            ) : (
              <button className="popup-button" onClick={cerrarPopup}>
                Cerrar
              </button>
            )}
          </div>
        </div>
      )}
    </>
  )
}

export default LandingPage
