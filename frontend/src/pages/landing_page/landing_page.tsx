import './landing_page.css'
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom' // Importar para capturar el :id_usuario y navegar
import { useAuth0 } from '@auth0/auth0-react' // Para validar contra el usuario real
import { Pencil, Trash2 } from 'lucide-react'

interface Collection {
  id: string
  user_id: string
  name: string
  description: string | null
  status: string
  created_at: string
}

function LandingPage() {
  const { id_usuario } = useParams<{ id_usuario: string }>() // Captura el parámetro de la URL
  const { user, getAccessTokenSilently } = useAuth0() // Obtenemos la info del usuario logueado

  const [estado, setEstado] = useState<
    'idle' | 'loading' | 'success' | 'error'
  >('idle')
  const [mensaje, setMensaje] = useState('')

  // Opcional: Validación de seguridad
  // Extraemos el ID real del token para comparar con la URL
  const currentUserId = user?.sub?.split('|')[1] || user?.nickname
  const navigate = useNavigate()

  const [colecciones, setColecciones] = useState<Collection[]>([])
  const [cargandoColecciones, setCargandoColecciones] = useState(true)

  const handleIniciar = async () => {
    navigate(`/${id_usuario || currentUserId}/colecciones/nueva/buscador`, {
      state: { abrirModalCarga: true },
    })
  }

  const editarColeccion = async (idColeccion: string, nombreActual: string) => {
    const nuevoNombre = window.prompt(
      'Nuevo nombre de la colección:',
      nombreActual,
    )

    if (!nuevoNombre || nuevoNombre.trim() === '') return

    try {
      const token = await getAccessTokenSilently()

      const response = await fetch(
        `http://localhost:8000/api/collections/${idColeccion}`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            name: nuevoNombre.trim(),
          }),
        },
      )

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data?.detail || 'Error al actualizar la colección')
      }

      setColecciones((prev) =>
        prev.map((coleccion) =>
          coleccion.id === idColeccion
            ? { ...coleccion, name: data.name }
            : coleccion,
        ),
      )
    } catch (error) {
      console.error('Error editando colección:', error)
      setEstado('error')
      setMensaje('No se pudo cambiar el nombre de la colección')
    }
  }

  const eliminarColeccion = async (idColeccion: string) => {
    const confirmar = window.confirm(
      '¿Seguro quieres eliminar esta colección? Esta acción no se puede deshacer',
    )

    if (!confirmar) return

    try {
      const token = await getAccessTokenSilently()

      const response = await fetch(
        `http://localhost:8000/api/collections/${idColeccion}`,
        {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      )

      if (!response.ok) {
        const text = await response.text()
        const data = text ? JSON.parse(text) : null
        throw new Error(data?.detail || 'Error al eliminar la colección')
      }

      setColecciones((prev) =>
        prev.filter((coleccion) => coleccion.id !== idColeccion),
      )
    } catch (error) {
      console.error('Error eliminando colección:', error)
      setEstado('error')
      setMensaje('No se pudo eliminar la colección')
    }
  }

  useEffect(() => {
    const fetchColecciones = async () => {
      try {
        const token = await getAccessTokenSilently()

        const response = await fetch('http://localhost:8000/api/collections', {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        })

        const data = await response.json()

        if (!response.ok) {
          throw new Error(data?.detail || 'Error al cargar colecciones')
        }

        setColecciones(data)
      } catch (error) {
        console.error('Error cargando colecciones:', error)
        setEstado('error')
        setMensaje('No se pudieron cargar las colecciones')
      } finally {
        setCargandoColecciones(false)
      }
    }

    fetchColecciones()
  }, [getAccessTokenSilently])

  const probarMensaje = () => {
    const prob = Math.random()

    if (prob > 0.5) {
      setEstado('success')
      setMensaje('Éxito: la operación se realizó correctamente.')
    } else {
      setEstado('error')
      setMensaje('Error: no se pudo completar la operación.')
    }
  }

  const abrirColeccionExistente = (idColeccion: string) => {
    navigate(
      `/${id_usuario || currentUserId}/colecciones/${idColeccion}/buscador`,
      {
        state: { abrirModalCarga: false },
      },
    )
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
          <button className="message-test-btn" onClick={probarMensaje}>
            Probar mensaje
          </button>
        </section>

        <section className="collections">
          <h2 className="collections-title">Colecciones anteriores</h2>

          <div className="grid">
            {cargandoColecciones ? (
              <p>Cargando colecciones...</p>
            ) : colecciones.length === 0 ? (
              <p>No tienes colecciones todavía.</p>
            ) : (
              colecciones.map((coleccion) => (
                <button
                  key={coleccion.id}
                  type="button"
                  className="card"
                  onClick={() => abrirColeccionExistente(coleccion.id)}
                >
                  <div className="card-actions">
                    <button
                      type="button"
                      className="card-icon-btn"
                      aria-label="Editar colección"
                      onClick={(e) => {
                        e.stopPropagation()
                        editarColeccion(coleccion.id, coleccion.name)
                      }}
                    >
                      <Pencil size={18} />
                    </button>

                    <button
                      type="button"
                      className="card-icon-btn card-icon-delete"
                      aria-label="Eliminar colección"
                      onClick={(e) => {
                        e.stopPropagation()
                        eliminarColeccion(coleccion.id)
                      }}
                    >
                      <Trash2 size={18} />
                    </button>
                  </div>

                  <h3>{coleccion.name}</h3>
                </button>
              ))
            )}
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
