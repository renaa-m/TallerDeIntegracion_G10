import '@testing-library/jest-dom'
import { act } from '@testing-library/react'
import { TextEncoder, TextDecoder } from 'util'
import { syncThemeClass } from './lib/theme'

Object.assign(globalThis, {
  TextEncoder,
  TextDecoder,
})

process.env.VITE_API_URL = 'http://localhost:8080'

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: jest.fn().mockImplementation(() => ({
    matches: false,
    media: '(prefers-color-scheme: dark)',
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
  })),
})

beforeEach(() => {
  document.documentElement.classList.remove('bc-dark')
  syncThemeClass()
})

// Drena microtareas pendientes dentro de act() al terminar cada test, para que
// los setState asíncronos rezagados (ej. el final de un useEffect que hace fetch)
// se resuelvan dentro de un scope act().
afterEach(async () => {
  await act(async () => {
    await Promise.resolve()
  })
})

// Silencia ruido de consola que no indica fallos reales en los tests:
//  - Warnings "not wrapped in act(...)" de actualizaciones async inevitables.
//  - Logs que el código de la app emite a propósito en caminos de error que los
//    tests ejercitan deliberadamente (se verifican vía aserciones, no por consola).
const _origError = console.error.bind(console)
const _origLog = console.log.bind(console)

const _SILENCED_ERROR_PATTERNS = [
  'not wrapped in act',
  'Error cargando colecciones:',
  'Error editando colección:',
  'Error eliminando colección:',
  'Error en búsqueda:',
  'Error al recuperar estado tras recarga:',
  'Error response:',
  'Error obteniendo URL firmada:',
  'Error al acceder al documento:',
  'Error del backend:',
  'Error fetching graph:',
  'Error:',
]

const _SILENCED_LOG_PATTERNS = [
  '1. API URL:',
  '2. Token obtenido:',
  '3. URL completa:',
  '4. Status respuesta:',
  'Búsqueda completada:',
  '📝 Storage path enviado:',
  'Modal isOpen:',
]

console.error = (...args: unknown[]) => {
  const first = typeof args[0] === 'string' ? args[0] : ''
  if (_SILENCED_ERROR_PATTERNS.some((p) => first.includes(p))) return
  _origError(...args)
}

console.log = (...args: unknown[]) => {
  const first = typeof args[0] === 'string' ? args[0] : ''
  if (_SILENCED_LOG_PATTERNS.some((p) => first.includes(p))) return
  _origLog(...args)
}
