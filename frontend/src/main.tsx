import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Auth0Provider } from '@auth0/auth0-react';
import App from './App.tsx';
import './index.css';

// Reemplaza estos valores con tus credenciales de la consola de Auth0
const domain = "dev-cz6hwcuqrlsmuej4.us.auth0.com";
const clientId = "Am1qXEru783KHoCiPSgWNA3Rk6K6tckC";


createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Auth0Provider
      domain={domain}
      clientId={clientId}
      authorizationParams={{
        redirectUri: window.location.origin
      }}
    >
      <App />
    </Auth0Provider>
  </StrictMode>,
)
