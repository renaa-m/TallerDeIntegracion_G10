import { useAuth0 } from '@auth0/auth0-react'
import { BookOpen } from 'lucide-react'
import './login_page.css'

const LoginPage = () => {
  const { loginWithRedirect } = useAuth0()

  const handleLogin = async () => {
    try {
      await loginWithRedirect()
    } catch (error) {
      console.error('Error al iniciar sesión:', error)
    }
  }

  return (
    <div className="login-page-wrapper">
      <div className="login-card">
        <div className="icon-box">
          <BookOpen size={34} color="#111" />
        </div>

        <h1 className="login-title">NotebookIMFD</h1>

        <p className="login-subtitle">
          Plataforma de Investigación en Humanidades Digitales del IMFD.
        </p>

        <button className="imfd-btn-primary" onClick={handleLogin}>
          Iniciar Sesión
        </button>

        <div className="footer-brand">
          Instituto Milenio Fundamentos de los Datos
        </div>
      </div>
    </div>
  )
}

export default LoginPage
