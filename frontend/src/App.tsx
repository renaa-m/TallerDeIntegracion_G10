import { Routes, Route, Navigate, useNavigate, Outlet } from 'react-router-dom'
import { useAuth0 } from '@auth0/auth0-react'
import { useEffect } from 'react'
import LandingPage from './pages/landing_page/landing_page'
import LoginPage from './pages/login_page/login_page'
import Navbar from './pages/navbar/navbar'
import BuscadorColeccion from './pages/buscador_coleccion/buscador_coleccion'
import GraphViewer from './pages/visualizador_grafo/visualizador_grafo'

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

  return (
    <div className="h-screen flex items-center justify-center bg-[#243166]">
      <div className="flex flex-col items-center gap-4">
        <div className="w-10 h-10 border-4 border-[#FBFFA1] border-t-transparent rounded-full animate-spin"></div>
        <p className="text-[#FBFFA1] font-black text-xs uppercase italic">
          Sincronizando...
        </p>
      </div>
    </div>
  )
}

function App() {
  const { isAuthenticated, isLoading, user } = useAuth0()

  if (isLoading) {
    return (
      <div className="h-screen flex items-center justify-center bg-[#243166]">
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 border-4 border-[#FBFFA1] border-t-transparent rounded-full animate-spin"></div>
          <p className="text-[#FBFFA1] font-black text-xs uppercase italic">
            Sincronizando...
          </p>
        </div>
      </div>
    )
  }

  const userId = user?.sub?.split('|')[1] || user?.nickname

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        width: '100vw',
        overflow: 'hidden'
      }}
    >
      <Navbar />
      {/* Colchón para la Navbar fija de 70px */}
      <div style={{ height: '70px', flexShrink: 0 }} />
      
      <main
        style={{
          flex: 1,
          minHeight: 0,
          width: '100%',
          position: 'relative',
          overflow: 'hidden', 
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
            element={isAuthenticated ? <BuscadorColeccion /> : <Navigate to="/" replace />}
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
                <Navigate to="/" replace />
              )
            }
          />
          
          <Route
            path="/landing-page/:id_usuario"
            element={
              isAuthenticated ? <LandingPage /> : <Navigate to="/" replace />
            }
          />
          <Route
            path="/login"
            element={
              !isAuthenticated ? <LoginPage /> : <Navigate to="/" replace />
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  )
}

export default App