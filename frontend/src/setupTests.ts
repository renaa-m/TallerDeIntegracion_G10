import '@testing-library/jest-dom'
import { TextEncoder, TextDecoder } from 'util'

Object.assign(globalThis, {
  TextEncoder,
  TextDecoder,
})

process.env.VITE_API_URL = 'http://localhost:8080'
