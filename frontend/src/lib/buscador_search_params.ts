export type BuscadorUrlFilters = {
  q: string
  entities: string[]
  entityLogic: 'OR' | 'AND'
  entityType: string | null
  page: number
}

export function parseEntityLabelsFromUrl(raw: string | null): string[] {
  if (!raw) return []
  return raw
    .split(',')
    .map((value) => decodeURIComponent(value.trim()))
    .filter(Boolean)
}

export function readBuscadorFiltersFromSearchParams(
  params: URLSearchParams,
): BuscadorUrlFilters {
  const pageRaw = parseInt(params.get('page') ?? '1', 10)
  return {
    q: params.get('q') ?? '',
    entities: parseEntityLabelsFromUrl(params.get('entities')),
    entityLogic: params.get('entity_logic') === 'AND' ? 'AND' : 'OR',
    entityType: params.get('entity_type'),
    page: Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1,
  }
}

export function buildBuscadorSearchParams(
  filters: Partial<BuscadorUrlFilters>,
): URLSearchParams {
  const params = new URLSearchParams()
  const q = filters.q?.trim()
  if (q) params.set('q', q)

  const entities = filters.entities ?? []
  if (entities.length > 0) {
    params.set('entities', entities.map(encodeURIComponent).join(','))
  }

  if (filters.entityLogic === 'AND') {
    params.set('entity_logic', 'AND')
  }

  if (filters.entityType) {
    params.set('entity_type', filters.entityType)
  }

  const page = filters.page ?? 1
  if (page > 1) params.set('page', String(page))

  return params
}
