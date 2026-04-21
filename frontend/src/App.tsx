import { useState } from 'react'
import reactLogo from './assets/react.svg'
import viteLogo from './assets/vite.svg'
import heroImg from './assets/hero.png'
import './App.css'
import LandingPage from "./pages/landing_page/landing_page";

// Importamos los componentes de autenticación - Auth0 Configuración Inicial
import { useAuth0 } from '@auth0/auth0-react'
import LoginButton from './login.tsx'
import { LogoutButton } from './logout.tsx'

function App() {
  
  const [count, setCount] = useState(0)
  const [isDropdownOpen, setIsDropdownOpen] = useState(false)
  const { isAuthenticated, isLoading, user } = useAuth0()

  if (isLoading) {
    return <div className="loading">Cargando...</div>
  }

  // VISTA PÚBLICA (Landing)
  if (!isAuthenticated) {
    return <LandingPage />
  }

  // VISTA PRIVADA (Autenticado)
  return (
    <>
      <header className="main-header">
        <div style={{ position: 'relative' }}>
          <img
            src={user?.picture}
            alt={user?.name}
            onClick={() => setIsDropdownOpen(!isDropdownOpen)}
            className="user-avatar"
          />

          {isDropdownOpen && (
            <div className="profile-dropdown">
              <p className="user-name">{user?.name}</p>
              <p className="user-email">{user?.email}</p>
              <hr className="dropdown-divider" />
              <div className="logout-wrapper">
                <LogoutButton />
              </div>
            </div>
          )}
        </div>
      </header>

      <section id="center">
        <div className="hero">
          <img src={heroImg} className="base" width="170" height="179" alt="" />
          <img src={reactLogo} className="framework" alt="React logo" />
          <img src={viteLogo} className="vite" alt="Vite logo" />
        </div>
        <div>
          <h1>Get started</h1>
          <p>
            Edit <code>src/App.tsx</code> and save to test <code>HMR</code>
          </p>
        </div>

        <button className="counter" onClick={() => setCount((c) => c + 1)}>
          Count is {count}
        </button>
      </section>

      <div className="ticks"></div>

      <section id="next-steps">
        <div id="docs">
          <svg className="icon" role="presentation">
            <use href="/icons.svg#documentation-icon"></use>
          </svg>
          <h2>Documentation</h2>
          <p>Your questions, answered</p>
          <ul>
            <li>
              <a href="https://vite.dev/" target="_blank">
                <img className="logo" src={viteLogo} alt="" />
                Explore Vite
              </a>
            </li>
            <li>
              <a href="https://react.dev/" target="_blank">
                <img className="button-icon" src={reactLogo} alt="" />
                Learn more
              </a>
            </li>
          </ul>
        </div>
      </section>

      <div className="ticks"></div>
      <section id="spacer"></section>
    </>
  )
}

export default App
