import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Auth0Provider } from '@auth0/auth0-react'
import { BrowserRouter } from 'react-router-dom' // 1. Importa el Router
import App from './App.tsx'
import './index.css'

const domain = 'dev-cz6hwcuqrlsmuej4.us.auth0.com'
const clientId = 'Am1qXEru783KHoCiPSgWNA3Rk6K6tckC'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Auth0Provider
      domain={domain}
      clientId={clientId}
      authorizationParams={{
        redirectUri: window.location.origin,
      }}
    >
      {/* 2. Envuelve App con BrowserRouter */}
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </Auth0Provider>
  </StrictMode>,
)
