import '@testing-library/jest-dom'
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
