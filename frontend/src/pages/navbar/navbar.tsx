import { useState } from 'react';
import { useAuth0 } from '@auth0/auth0-react';
import { ChevronDown, LogOut, User } from 'lucide-react';
import { Link } from 'react-router-dom';
import './navbar.css';

const Navbar = () => {
  const { isAuthenticated, user, logout } = useAuth0();
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const userId = user?.sub?.split('|')[1] || user?.nickname;

  const handleLogout = () => {
    logout({ logoutParams: { returnTo: window.location.origin } });
  };

  return (
    <nav className="navbar">
      <div className="navbar-container">
        {/* Izquierda: Identidad */}
        {isAuthenticated ? (
          <Link to={`/landing-page/${userId}`} className="navbar-brand">IMFD</Link>
        ) : (
          <div className="navbar-brand">IMFD</div>
        )}

        {/* Derecha: Navegación y Perfil */}
        <div className="navbar-actions">
          <a href="#" className="nav-link">Nosotros</a>
          
          {isAuthenticated && (
            <div className="profile-wrapper">
              <button 
                className="profile-trigger" 
                onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                aria-haspopup="true"
                aria-expanded={isDropdownOpen}
              >
                {user?.picture ? (
                  <img src={user.picture} alt={user.name} className="nav-avatar" />
                ) : (
                  <div className="nav-avatar-placeholder"><User size={20} /></div>
                )}
                <ChevronDown size={16} className={`chevron ${isDropdownOpen ? 'rotate' : ''}`} />
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
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </nav>
  );
};

export default Navbar;