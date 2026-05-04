import { useState } from 'react'
import { useAuth0 } from '@auth0/auth0-react'
import { ChevronDown, LogOut, User, Trash2 } from 'lucide-react'
import { Link } from 'react-router-dom'
import ModalEliminarCuenta from '../../components/modal_eliminar_cuenta/modal_eliminar_cuenta'
import './navbar.css'

const Navbar = () => {
  const { isAuthenticated, user, logout, getAccessTokenSilently } = useAuth0()
  const [isDropdownOpen, setIsDropdownOpen] = useState(false)
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)

  const displayId = user?.sub?.split('|')[1] || user?.nickname

  const handleLogout = () => {
    logout({ logoutParams: { returnTo: window.location.origin } })
  }

  const handleDeleteAccount = async () => {
    setIsDeleting(true)
    try {
      console.log('1. API URL:', import.meta.env.VITE_API_URL)

      const token = await getAccessTokenSilently()
      console.log('2. Token obtenido:', token ? 'sí' : 'no')

      const url = `${import.meta.env.VITE_API_URL}/usuarios/me`
      console.log('3. URL completa:', url)

      const response = await fetch(url, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })

      console.log('4. Status respuesta:', response.status)

      if (response.ok) {
        logout({ logoutParams: { returnTo: window.location.origin } })
      } else {
        const error = await response.json().catch(() => null)
        console.error('Error del backend:', error)
        alert('Hubo un error al eliminar la cuenta.')
      }
    } catch (error) {
      console.error('Error:', error)
      alert('No se pudo conectar con el servidor.')
    } finally {
      setIsDeleting(false)
      setIsDeleteModalOpen(false)
    }
  }

  return (
    <nav className="navbar">
      <div className="navbar-container">
        <Link
          to={isAuthenticated ? `/landing-page/${displayId}` : '/'}
          className="navbar-brand"
        >
          <img
            src="https://portalpsw.dcc.uchile.cl/media/Logo_Principal_Color.png"
            alt="IMFD logo"
            className="navbar-logo"
          />
        </Link>

        <div className="navbar-actions">
          {isAuthenticated && (
            <div className="profile-wrapper">
              <button
                className="profile-trigger"
                onClick={() => setIsDropdownOpen(!isDropdownOpen)}
              >
                {user?.picture ? (
                  <img
                    src={user.picture}
                    alt={user.name}
                    className="nav-avatar"
                  />
                ) : (
                  <div className="nav-avatar-placeholder">
                    <User size={20} />
                  </div>
                )}
                <ChevronDown
                  size={16}
                  className={`chevron ${isDropdownOpen ? 'rotate' : ''}`}
                />
              </button>

              {isDropdownOpen && (
                <div className="nav-dropdown">
                  <div className="dropdown-user-info">
                    <p className="user-name">{user?.name || 'Usuario'}</p>
                    <p className="user-email">{user?.email}</p>
                  </div>
                  <div className="dropdown-divider"></div>

                  <button className="logout-action" onClick={handleLogout}>
                    <LogOut size={16} />
                    <span>Cerrar Sesión</span>
                  </button>

                  <button
                    className="delete-account-action"
                    onClick={() => {
                      setIsDropdownOpen(false)
                      setIsDeleteModalOpen(true)
                    }}
                  >
                    <Trash2 size={16} />
                    <span>Eliminar Cuenta</span>
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <ModalEliminarCuenta
        isOpen={isDeleteModalOpen}
        onClose={() => setIsDeleteModalOpen(false)}
        onConfirm={handleDeleteAccount}
        isDeleting={isDeleting}
      />
    </nav>
  )
}

export default Navbar
