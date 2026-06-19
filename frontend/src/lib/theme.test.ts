import { THEME_DARK_CLASS, getPrefersDarkMode, syncThemeClass } from './theme'

describe('theme', () => {
  beforeEach(() => {
    document.documentElement.classList.remove(THEME_DARK_CLASS)
  })

  test('syncThemeClass añade bc-dark cuando matchMedia indica dark', () => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: jest.fn().mockImplementation(() => ({
        matches: true,
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
      })),
    })

    expect(syncThemeClass()).toBe(true)
    expect(document.documentElement).toHaveClass(THEME_DARK_CLASS)
    expect(getPrefersDarkMode()).toBe(true)
  })

  test('syncThemeClass quita bc-dark en modo claro', () => {
    document.documentElement.classList.add(THEME_DARK_CLASS)

    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: jest.fn().mockImplementation(() => ({
        matches: false,
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
      })),
    })

    expect(syncThemeClass()).toBe(false)
    expect(document.documentElement).not.toHaveClass(THEME_DARK_CLASS)
  })
})
