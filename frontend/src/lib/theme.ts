import { useSyncExternalStore } from 'react'

/** Clase global en `<html>` cuando el sistema prefiere modo oscuro. */
export const THEME_DARK_CLASS = 'bc-dark'

const DARK_MEDIA = '(prefers-color-scheme: dark)'

export function getPrefersDarkMode(): boolean {
  if (typeof window === 'undefined') return false
  return window.matchMedia(DARK_MEDIA).matches
}

export function syncThemeClass(): boolean {
  if (typeof document === 'undefined') return false
  const dark = getPrefersDarkMode()
  document.documentElement.classList.toggle(THEME_DARK_CLASS, dark)
  return dark
}

export function subscribePrefersDarkMode(
  onChange: (dark: boolean) => void,
): () => void {
  if (typeof window === 'undefined') return () => {}

  const media = window.matchMedia(DARK_MEDIA)
  const handler = () => {
    const dark = syncThemeClass()
    onChange(dark)
  }

  handler()
  media.addEventListener('change', handler)
  return () => media.removeEventListener('change', handler)
}

export function usePrefersDarkMode(): boolean {
  return useSyncExternalStore(
    subscribePrefersDarkMode,
    getPrefersDarkMode,
    () => false,
  )
}
