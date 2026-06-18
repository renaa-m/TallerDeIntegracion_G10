import {
  buildBuscadorSearchParams,
  parseEntityLabelsFromUrl,
  readBuscadorFiltersFromSearchParams,
} from '../lib/buscador_search_params'

describe('buscador_search_params', () => {
  test('parseEntityLabelsFromUrl decodifica etiquetas separadas por coma', () => {
    expect(parseEntityLabelsFromUrl('Persona,Organizaci%C3%B3n')).toEqual([
      'Persona',
      'Organización',
    ])
  })

  test('readBuscadorFiltersFromSearchParams lee query, entidades y lógica', () => {
    const params = new URLSearchParams(
      'q=alpha&entities=Persona%2CEvento&entity_logic=AND&entity_type=Persona&page=2',
    )

    expect(readBuscadorFiltersFromSearchParams(params)).toEqual({
      q: 'alpha',
      entities: ['Persona', 'Evento'],
      entityLogic: 'AND',
      entityType: 'Persona',
      page: 2,
    })
  })

  test('buildBuscadorSearchParams omite valores por defecto', () => {
    const params = buildBuscadorSearchParams({
      q: '  consulta  ',
      entities: ['Persona'],
      entityLogic: 'OR',
      entityType: null,
      page: 1,
    })

    expect(params.toString()).toBe('q=consulta&entities=Persona')
  })

  test('buildBuscadorSearchParams incluye AND, tipo y página', () => {
    const params = buildBuscadorSearchParams({
      entities: ['A', 'B'],
      entityLogic: 'AND',
      entityType: 'Lugar',
      page: 3,
    })

    expect(params.get('entity_logic')).toBe('AND')
    expect(params.get('entity_type')).toBe('Lugar')
    expect(params.get('page')).toBe('3')
    expect(params.get('entities')).toBe('A,B')
  })
})
