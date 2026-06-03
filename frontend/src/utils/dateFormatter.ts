/**
 * Formatea valores que podrían ser fechas en diferentes formatos
 * Soporta:
 * - ISO 8601 comprimido: "T19741015" -> "15 de octubre de 1974"
 * - ISO 8601 completo: "1974-10-15T00:00:00Z"
 * - Timestamps numéricos
 */

export function formatDateValue(value: unknown): string {
  if (typeof value !== 'string' && typeof value !== 'number') {
    return String(value)
  }

  const strValue = String(value).trim()

  // Patrón: T + 8 dígitos (YYYYMMDD)
  const compressedIsoMatch = strValue.match(/^T(\d{4})(\d{2})(\d{2})$/)
  if (compressedIsoMatch) {
    const [, year, month, day] = compressedIsoMatch
    return formatDate(new Date(`${year}-${month}-${day}`))
  }

  // ISO 8601 estándar
  const isoMatch = strValue.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (isoMatch) {
    const [, year, month, day] = isoMatch
    return formatDate(new Date(`${year}-${month}-${day}`))
  }

  // Timestamp numérico (milisegundos)
  const numValue = Number(value)
  if (!Number.isNaN(numValue) && numValue > 0) {
    // Detectar si es segundos (< 10000000000) o milisegundos
    const timestamp = numValue < 10000000000 ? numValue * 1000 : numValue
    return formatDate(new Date(timestamp))
  }

  return strValue
}

function formatDate(date: Date): string {
  if (Number.isNaN(date.getTime())) {
    return String(date)
  }

  const options: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }

  return new Intl.DateTimeFormat('es-ES', options).format(date)
}

/**
 * Detecta si una clave de propiedad probablemente contenga una fecha
 */
export function isProbablyDateKey(key: string): boolean {
  const dateKeywords = [
    'fecha',
    'date',
    'creado',
    'created',
    'modificado',
    'modified',
    'actualizado',
    'updated',
    'año',
    'year',
    'año_inicio',
    'año_fin',
  ]
  return dateKeywords.some((keyword) =>
    key.toLowerCase().includes(keyword),
  )
}

/**
 * Detecta si un valor probablemente sea una fecha
 */
export function isProbablyDateValue(value: unknown): boolean {
  if (typeof value !== 'string' && typeof value !== 'number') {
    return false
  }

  const strValue = String(value).trim()

  // Patrón: T + 8 dígitos
  if (/^T\d{8}$/.test(strValue)) {
    return true
  }

  // ISO 8601
  if (/^\d{4}-\d{2}-\d{2}/.test(strValue)) {
    return true
  }

  // Timestamp
  const numValue = Number(value)
  if (!Number.isNaN(numValue)) {
    // Rango razonable: 1990-2100 en milisegundos
    return numValue > 631152000000 && numValue < 4102444800000
  }

  return false
}
