import { Routes, Route, Navigate, useNavigate, Outlet } from 'react-router-dom'
import { useAuth0 } from '@auth0/auth0-react'
import { useEffect } from 'react'
import LandingPage from './pages/landing_page/landing_page'
import LoginPage from './pages/login_page/login_page'
import Navbar from './pages/navbar/navbar'
import BuscadorColeccion from './pages/buscador_coleccion/buscador_coleccion'
import GraphViewer from './pages/visualizador_grafo/visualizador_grafo'
import AppLoading from './components/ui/app_loading'

// Componente que maneja el callback de Auth0
function CallbackHandler() {
  const { isAuthenticated, isLoading, user } = useAuth0()
  const navigate = useNavigate()

  useEffect(() => {
    if (!isLoading && isAuthenticated && user) {
      const userId = user?.sub?.split('|')[1] || user?.nickname
      navigate(`/landing-page/${userId}`, { replace: true })
    }
  }, [isLoading, isAuthenticated, user, navigate])

  return <AppLoading message="Sincronizando..." />
}

function App() {
  const { isAuthenticated, isLoading, user } = useAuth0()

  if (isLoading) {
    return <AppLoading message="Sincronizando..." />
  }

  const userId = user?.sub?.split('|')[1] || user?.nickname

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        width: '100vw',
        overflow: 'hidden',
      }}
    >
      <Navbar />
      <div
        style={{ height: 'var(--navbar-height)', flexShrink: 0 }}
        aria-hidden="true"
      />

      <main
        style={{
          flex: 1,
          minHeight: 0,
          width: '100%',
          position: 'relative',
          overflow: 'auto',
        }}
      >
        <Routes>
          <Route
            path="/"
            element={
              isAuthenticated ? (
                <Navigate to={`/landing-page/${userId}`} replace />
              ) : (
                <LoginPage />
              )
            }
          />
          <Route path="/callback" element={<CallbackHandler />} />

          {/* 🚀 CORRECCIÓN CRÍTICA: Rutas Anidadas Estructuradas para las Colecciones */}
          <Route
            path="/:id_usuario/colecciones/:id_coleccion"
            element={
              isAuthenticated ? (
                <BuscadorColeccion />
              ) : (
                <Navigate to="/login" replace />
              )
            }
          >
            {/* Vista por defecto: el buscador semántico interno */}
            <Route path="buscador" element={<Outlet />} />

            {/* Cuando la URL sea /.../coleccion/123/grafo, se inyectará aquí de forma limpia */}
            <Route path="grafo" element={<GraphViewer />} />
          </Route>

          <Route
            path="/:id_usuario/buscador-coleccion"
            element={
              isAuthenticated ? (
                <BuscadorColeccion />
              ) : (
                <Navigate to="/login" replace />
              )
            }
          />

          <Route
            path="/landing-page/:id_usuario"
            element={
              isAuthenticated ? (
                <LandingPage />
              ) : (
                <Navigate to="/login" replace />
              )
            }
          />
          <Route
            path="/login"
            element={
              !isAuthenticated ? (
                <LoginPage />
              ) : (
                <Navigate to="/login" replace />
              )
            }
          />
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </main>
    </div>
  )
}

export default App
