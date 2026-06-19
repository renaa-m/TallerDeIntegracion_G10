import {
  getCollectionCardProgressLabel,
  getOverallPipelinePercent,
  getPipelineProgressDisplay,
  getProcessingBannerView,
  getSearchAvailability,
  SEARCH_BLOCKED_GRAPH_MESSAGE,
  SEARCH_BLOCKED_UPLOAD_MESSAGE,
  canShowDocumentListNavigation,
  canShowGraphNavigation,
  shouldRestoreModalOnPageLoad,
  readInitialModalOpenState,
  snapshotFromCollectionApi,
} from '../lib/collection_processing'

const COLLECTION_ID = 'collection-1'

function buildSnapshot(
  overrides: Partial<ReturnType<typeof snapshotFromCollectionApi>> & {
    processing_status?: string
    text_progress_total?: number
    text_progress_processed?: number
    graph_progress_total?: number
    graph_progress_processed?: number
  },
) {
  return snapshotFromCollectionApi(
    {
      name: 'Mi colección',
      processing_status: overrides.processing_status,
      text_progress_total: overrides.text_progress_total,
      text_progress_processed: overrides.text_progress_processed,
      graph_progress_total: overrides.graph_progress_total,
      graph_progress_processed: overrides.graph_progress_processed,
    },
    COLLECTION_ID,
  )
}

describe('collection_processing progress', () => {
  test('extracción al 50 % de documentos → 25 % global en banner y tarjeta; barra modal al 50 % de la etapa', () => {
    const snapshot = buildSnapshot({
      processing_status: 'processing_text',
      text_progress_total: 4,
      text_progress_processed: 2,
    })
    const overall = getOverallPipelinePercent(snapshot)
    const banner = getProcessingBannerView(snapshot)
    const modal = getPipelineProgressDisplay(snapshot)
    const card = getCollectionCardProgressLabel({
      processing_status: 'processing_text',
      text_progress_total: 4,
      text_progress_processed: 2,
    })

    expect(overall).toBe(25)
    expect(banner.progressPercent).toBe(25)
    expect(banner.progressCaption).toBe('25%')
    expect(modal.overallPercent).toBe(25)
    expect(modal.textCardPercentLabel).toBe('50%')
    expect(modal.textCardBarWidth).toBe(50)
    expect(card).toBe('Extracción de Texto · 25%')
  })

  test('grafo al 0 % con 1 paso → 50 % global en banner; extracción completa y grafo al 0 % en modal', () => {
    const snapshot = buildSnapshot({
      processing_status: 'processing_graph',
      text_progress_total: 2,
      text_progress_processed: 2,
      graph_progress_total: 1,
      graph_progress_processed: 0,
    })
    const overall = getOverallPipelinePercent(snapshot)
    const banner = getProcessingBannerView(snapshot)
    const modal = getPipelineProgressDisplay(snapshot)

    expect(overall).toBe(50)
    expect(banner.progressPercent).toBe(50)
    expect(banner.progressCaption).toBe('50%')
    expect(modal.overallPercent).toBe(50)
    expect(modal.textCardPercentLabel).toBe('Completada')
    expect(modal.textCardBarWidth).toBe(100)
    expect(modal.graphCardPercentLabel).toBe('0%')
    expect(modal.graphCardBarWidth).toBe(0)
  })

  test('grafo al 100 % → 100 % global', () => {
    const snapshot = buildSnapshot({
      processing_status: 'processing_graph',
      text_progress_total: 2,
      text_progress_processed: 2,
      graph_progress_total: 4,
      graph_progress_processed: 4,
    })
    const overall = getOverallPipelinePercent(snapshot)
    const banner = getProcessingBannerView(snapshot)
    const modal = getPipelineProgressDisplay(snapshot)

    expect(overall).toBe(100)
    expect(banner.progressPercent).toBe(100)
    expect(banner.progressCaption).toBe('100%')
    expect(modal.graphCardPercentLabel).toBe('100%')
    expect(modal.graphCardBarWidth).toBe(100)
  })

  test('confirmación de grafo → 50 % global', () => {
    const snapshot = buildSnapshot({
      processing_status: 'awaiting_graph_confirmation',
      text_progress_total: 3,
      text_progress_processed: 2,
    })
    const overall = getOverallPipelinePercent(snapshot)
    const modal = getPipelineProgressDisplay(snapshot)
    const card = getCollectionCardProgressLabel({
      processing_status: 'awaiting_graph_confirmation',
      text_progress_total: 3,
      text_progress_processed: 2,
    })

    expect(overall).toBe(50)
    expect(modal.textCardPercentLabel).toBe('Completada')
    expect(modal.textCardBarWidth).toBe(100)
    expect(card).toBe('Confirmación de Grafo · 50%')
  })
})

describe('collection_processing modal restore', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  test('solo restaura modal si pipeline y flag abierto coinciden', () => {
    localStorage.setItem('active_collection_id', 'collection-1')
    localStorage.setItem('modal_carga_etapa', 'pipeline')

    expect(shouldRestoreModalOnPageLoad('collection-1')).toBe(false)

    localStorage.setItem('modal_carga_open', '1')
    expect(shouldRestoreModalOnPageLoad('collection-1')).toBe(true)
    expect(shouldRestoreModalOnPageLoad('collection-2')).toBe(false)
  })

  test('no reabre modal en /nueva si el usuario lo cerró durante extracción', () => {
    localStorage.setItem('active_collection_id', 'collection-nueva')
    localStorage.setItem('modal_carga_etapa', 'pipeline')
    localStorage.setItem('modal_nueva_session', '1')

    expect(readInitialModalOpenState('nueva')).toEqual({
      open: false,
      pipeline: true,
    })

    localStorage.setItem('modal_carga_open', '1')
    expect(readInitialModalOpenState('nueva')).toEqual({
      open: true,
      pipeline: true,
    })
  })

  test('abre modal en /nueva en la primera visita sin sesión previa', () => {
    expect(readInitialModalOpenState('nueva')).toEqual({
      open: true,
      pipeline: false,
    })
  })

  test('no reabre modal en colección existente si el flag abierto no está', () => {
    localStorage.setItem('active_collection_id', 'collection-1')
    localStorage.setItem('modal_carga_etapa', 'pipeline')

    expect(readInitialModalOpenState('collection-1')).toEqual({
      open: false,
      pipeline: true,
    })
  })
})

describe('collection_processing search availability', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  test('bloquea búsqueda mientras se genera el grafo en la colección', () => {
    const availability = getSearchAvailability({
      collectionId: 'collection-1',
      processingStatus: 'processing_graph',
      isCollectionProcessing: true,
      isNuevaPage: false,
      hasBackgroundProcessingOnNueva: false,
    })

    expect(availability.disabled).toBe(true)
    expect(availability.message).toBe(SEARCH_BLOCKED_GRAPH_MESSAGE)
  })

  test('bloquea búsqueda mientras se suben documentos en segundo plano', () => {
    localStorage.setItem('active_collection_id', 'collection-1')
    localStorage.setItem('modal_carga_etapa', 'subida')

    const availability = getSearchAvailability({
      collectionId: 'collection-1',
      processingStatus: 'idle',
      isCollectionProcessing: false,
      isNuevaPage: false,
      hasBackgroundProcessingOnNueva: false,
    })

    expect(availability.disabled).toBe(true)
    expect(availability.message).toBe(SEARCH_BLOCKED_UPLOAD_MESSAGE)
  })

  test('habilita búsqueda cuando el grafo está listo', () => {
    const availability = getSearchAvailability({
      collectionId: 'collection-1',
      processingStatus: 'graph_ready',
      isCollectionProcessing: false,
      isNuevaPage: false,
      hasBackgroundProcessingOnNueva: false,
    })

    expect(availability.disabled).toBe(false)
    expect(availability.message).toBeNull()
  })
})

describe('collection_processing sidebar navigation', () => {
  test('documentos visibles en colección creada; grafo solo cuando está listo', () => {
    expect(canShowDocumentListNavigation('collection-1')).toBe(true)
    expect(canShowDocumentListNavigation('nueva')).toBe(false)

    expect(canShowGraphNavigation('processing_graph')).toBe(false)
    expect(canShowGraphNavigation('graph_ready')).toBe(true)
  })
})
