import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth0 } from '@auth0/auth0-react';
import Navbar from "./pages/navbar/navbar";
import LandingPage from "./pages/landing_page/landing_page";
import LoginPage from "./pages/login_page/login_page";
import { Coffee } from 'lucide-react';

function App() {
  const { isAuthenticated, isLoading } = useAuth0();

  // CRITICO: Este bloqueo detiene la redirección errónea al refrescar
  if (isLoading) {
    return (
      <div className="h-screen flex items-center justify-center bg-[#243166]">
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 border-4 border-[#FBFFA1] border-t-transparent rounded-full animate-spin"></div>
          <p className="text-[#FBFFA1] font-black text-xs tracking-widest uppercase italic">
            Verificando sesión...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-[#F8FAFC]">
      <Navbar />

      <main className="flex-grow pt-24">
        <Routes>
          {/* Ruta Raíz: Si está autenticado ve Landing, si no, lo manda a Login */}
          <Route 
            path="/" 
            element={isAuthenticated ? <LandingPage /> : <Navigate to="/login" />} 
          />
          
          {/* Ruta Login: Si ya está autenticado y entra aquí, lo devuelve a la raíz */}
          <Route 
            path="/login" 
            element={!isAuthenticated ? <LoginPage /> : <Navigate to="/" />} 
          />

          {/* Puedes añadir más rutas aquí */}
          <Route path="/nosotros" element={<div>Sección Nosotros</div>} />
        </Routes>
      </main>

      <footer className="app-footer">
        <p>hecho con <span className="heart">❤</span> y <Coffee size={16} className="coffee-icon" /></p>
      </footer>
    </div>
  );
}

export default App;