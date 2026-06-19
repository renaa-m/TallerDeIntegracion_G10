import { useEffect } from 'react'
import { subscribePrefersDarkMode } from '../lib/theme'

/** Sincroniza `bc-dark` en `<html>` con `prefers-color-scheme`. */
export default function ThemeSync() {
  useEffect(() => subscribePrefersDarkMode(() => {}), [])
  return null
}
