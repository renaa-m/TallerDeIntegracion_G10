/** Estados en los que el pipeline sigue activo en backend. */
export const PIPELINE_RUNNING_STATUSES = new Set([
  'processing_text',
  'processing_graph',
])

/** Incluye pausa por confirmación de grafo (sin cola). */
export const PIPELINE_IN_PROGRESS_STATUSES = new Set([
  'processing_text',
  'processing_graph',
  'awaiting_graph_confirmation',
])

export const ACTIVE_COLLECTION_KEY = 'active_collection_id'
export const MODAL_ETAPA_KEY = 'modal_carga_etapa'
export const MODAL_NUEVA_SESSION_KEY = 'modal_nueva_session'
export const MODAL_PIPELINE_ENTITIES_KEY = 'modal_pipeline_entities'
export const MODAL_CARGA_OPEN_KEY = 'modal_carga_open'

export type ModalEtapa = 'subida' | 'pipeline'

const PIPELINE_ENTITY_OPTIONS = new Set([
  'Persona',
  'Organizacion',
  'Lugar',
  'Evento',
])

/** Legacy: el backend ya no encola; tratar como idle. */
export function isPipelineQueued(status: string | undefined | null): boolean {
  return status === 'queued'
}

export function isPipelineInProgress(
  status: string | undefined | null,
): boolean {
  return !!status && PIPELINE_IN_PROGRESS_STATUSES.has(status)
}

export function isPipelineRunning(status: string | undefined | null): boolean {
  return !!status && PIPELINE_RUNNING_STATUSES.has(status)
}

export type CollectionLike = {
  id: string
  name: string
  processing_status?: string | null
}

/** Colección que ocupa el slot de procesamiento del usuario. */
export function findBlockingCollection(
  collections: CollectionLike[],
): CollectionLike | null {
  return (
    collections.find((c) => isPipelineInProgress(c.processing_status)) ?? null
  )
}

export function formatBlockingMessage(collectionName: string): string {
  return (
    `Se está procesando «${collectionName}». ` +
    'Espera a que termine antes de generar el grafo en otra colección.'
  )
}

/** Documentos subidos pero grafo aún no generado. */
export function isAwaitingGraphGeneration(
  status: string | undefined | null,
): boolean {
  return status === 'idle'
}

/** Modal de carga: etapa pipeline (generar grafo) vs subida de archivos. */
export function shouldOpenPipelineModal(
  processingStatus: string | undefined | null,
  options?: {
    documentCount?: number
    savedModalEtapa?: string | null
  },
): boolean {
  const status = processingStatus ?? 'idle'
  if (isPipelineInProgress(status)) return true
  if (
    status === 'graph_ready' ||
    status === 'partial_error' ||
    status === 'error'
  ) {
    return true
  }
  if (status === 'idle' || status === 'queued') {
    if (options?.savedModalEtapa === 'pipeline') return true
    if ((options?.documentCount ?? 0) > 0) return true
  }
  return false
}

/** Reabrir modal en etapa pipeline tras recargar la página del buscador. */
export function shouldRestorePipelineModalOnPageLoad(
  collectionId: string,
  processingStatus: string | undefined | null,
  options?: { documentCount?: number },
): boolean {
  if (!shouldRestoreModalOnPageLoad(collectionId)) return false

  return shouldOpenPipelineModal(processingStatus, {
    savedModalEtapa: 'pipeline',
    documentCount: options?.documentCount,
  })
}

export function readNuevaSessionCollectionId(): string | null {
  if (localStorage.getItem(MODAL_NUEVA_SESSION_KEY) !== '1') return null
  if (localStorage.getItem(MODAL_ETAPA_KEY) !== 'pipeline') return null
  return localStorage.getItem(ACTIVE_COLLECTION_KEY)
}

export function readModalEtapa(): ModalEtapa | null {
  const etapa = localStorage.getItem(MODAL_ETAPA_KEY)
  if (etapa === 'subida' || etapa === 'pipeline') return etapa
  return null
}

export function isUploadSessionForCollection(
  collectionId: string | null | undefined,
): boolean {
  if (!collectionId) return false
  return (
    localStorage.getItem(ACTIVE_COLLECTION_KEY) === collectionId &&
    localStorage.getItem(MODAL_ETAPA_KEY) === 'subida'
  )
}

export const SEARCH_BLOCKED_UPLOAD_MESSAGE =
  'Se están subiendo los documentos, espera unos momentos para preguntar.'

export const SEARCH_BLOCKED_GRAPH_MESSAGE =
  'Se está generando el grafo, espera unos momentos para preguntar.'

export type SearchAvailability = {
  disabled: boolean
  message: string | null
  placeholder: string
}

/** Cuándo bloquear la búsqueda semántica y qué mostrar al usuario. */
export function getSearchAvailability(options: {
  collectionId: string | null | undefined
  processingStatus: string | undefined | null
  isCollectionProcessing: boolean
  isNuevaPage: boolean
  hasBackgroundProcessingOnNueva: boolean
}): SearchAvailability {
  const status = options.processingStatus ?? 'idle'
  const defaultPlaceholder = 'Consulta algo a tus documentos...'

  if (options.isNuevaPage || options.collectionId === 'nueva') {
    if (
      options.hasBackgroundProcessingOnNueva ||
      options.isCollectionProcessing
    ) {
      if (localStorage.getItem(MODAL_ETAPA_KEY) === 'subida') {
        return {
          disabled: true,
          message: SEARCH_BLOCKED_UPLOAD_MESSAGE,
          placeholder: SEARCH_BLOCKED_UPLOAD_MESSAGE,
        }
      }
      return {
        disabled: true,
        message: SEARCH_BLOCKED_GRAPH_MESSAGE,
        placeholder: SEARCH_BLOCKED_GRAPH_MESSAGE,
      }
    }
    return {
      disabled: true,
      message: null,
      placeholder: 'Disponible cuando la colección esté creada',
    }
  }

  if (isUploadSessionForCollection(options.collectionId)) {
    return {
      disabled: true,
      message: SEARCH_BLOCKED_UPLOAD_MESSAGE,
      placeholder: SEARCH_BLOCKED_UPLOAD_MESSAGE,
    }
  }

  if (isPipelineInProgress(status) || options.isCollectionProcessing) {
    return {
      disabled: true,
      message: SEARCH_BLOCKED_GRAPH_MESSAGE,
      placeholder: SEARCH_BLOCKED_GRAPH_MESSAGE,
    }
  }

  if (!isGraphViewable(status)) {
    return {
      disabled: true,
      message:
        'Genera el grafo de la colección para habilitar la búsqueda semántica.',
      placeholder: 'Genera el grafo para habilitar la búsqueda',
    }
  }

  return {
    disabled: false,
    message: null,
    placeholder: defaultPlaceholder,
  }
}

export function hasPipelineModalIntent(collectionId: string): boolean {
  return (
    localStorage.getItem(ACTIVE_COLLECTION_KEY) === collectionId &&
    localStorage.getItem(MODAL_ETAPA_KEY) === 'pipeline'
  )
}

export function persistModalCargaOpen(open: boolean): void {
  if (open) {
    localStorage.setItem(MODAL_CARGA_OPEN_KEY, '1')
  } else {
    localStorage.removeItem(MODAL_CARGA_OPEN_KEY)
  }
}

export function isModalCargaOpenPersisted(): boolean {
  return localStorage.getItem(MODAL_CARGA_OPEN_KEY) === '1'
}

/** Reabrir modal solo si el usuario lo tenía abierto antes de recargar. */
export function shouldRestoreModalOnPageLoad(collectionId: string): boolean {
  return hasPipelineModalIntent(collectionId) && isModalCargaOpenPersisted()
}

export type InitialModalOpenState = {
  open: boolean
  pipeline: boolean
}

/** Estado inicial del modal tras F5 (respeta si el usuario lo había cerrado). */
export function readInitialModalOpenState(
  pageCollectionId: string | undefined,
): InitialModalOpenState {
  if (!pageCollectionId) {
    return { open: false, pipeline: false }
  }

  if (pageCollectionId === 'nueva') {
    const etapa = localStorage.getItem(MODAL_ETAPA_KEY)
    if (etapa === 'subida') {
      return { open: false, pipeline: false }
    }

    const pipeline =
      localStorage.getItem(MODAL_NUEVA_SESSION_KEY) === '1' &&
      etapa === 'pipeline' &&
      !!localStorage.getItem(ACTIVE_COLLECTION_KEY)

    if (!pipeline) {
      return { open: true, pipeline: false }
    }

    return {
      open: isModalCargaOpenPersisted(),
      pipeline: true,
    }
  }

  const pipeline = hasPipelineModalIntent(pageCollectionId)
  return {
    open: shouldRestoreModalOnPageLoad(pageCollectionId),
    pipeline,
  }
}

/** Colección marcada en localStorage para etapa pipeline (p. ej. tras recargar en /nueva). */
export function readPipelineTrackedCollectionId(): string | null {
  if (localStorage.getItem(MODAL_ETAPA_KEY) !== 'pipeline') return null
  return localStorage.getItem(ACTIVE_COLLECTION_KEY)
}

export function persistPipelineModalState(
  collectionId: string,
  options?: { nuevaSession?: boolean },
): void {
  localStorage.setItem(ACTIVE_COLLECTION_KEY, collectionId)
  localStorage.setItem(MODAL_ETAPA_KEY, 'pipeline')
  if (options?.nuevaSession === true) {
    localStorage.setItem(MODAL_NUEVA_SESSION_KEY, '1')
  } else if (options?.nuevaSession === false) {
    localStorage.removeItem(MODAL_NUEVA_SESSION_KEY)
  }
}

type PipelineEntitiesMap = Record<string, string[]>

function readPipelineEntitiesMap(): PipelineEntitiesMap {
  try {
    const raw = localStorage.getItem(MODAL_PIPELINE_ENTITIES_KEY)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      return {}
    }
    return parsed as PipelineEntitiesMap
  } catch {
    return {}
  }
}

function writePipelineEntitiesMap(map: PipelineEntitiesMap): void {
  if (Object.keys(map).length === 0) {
    localStorage.removeItem(MODAL_PIPELINE_ENTITIES_KEY)
    return
  }
  localStorage.setItem(MODAL_PIPELINE_ENTITIES_KEY, JSON.stringify(map))
}

export function readPipelineEntitySelection(collectionId: string): string[] {
  const saved = readPipelineEntitiesMap()[collectionId]
  if (!Array.isArray(saved)) return []
  return saved.filter(
    (entity): entity is string =>
      typeof entity === 'string' && PIPELINE_ENTITY_OPTIONS.has(entity),
  )
}

export function persistPipelineEntitySelection(
  collectionId: string,
  entities: string[],
): void {
  const valid = entities.filter((entity) => PIPELINE_ENTITY_OPTIONS.has(entity))
  const map = readPipelineEntitiesMap()
  if (valid.length === 0) {
    delete map[collectionId]
  } else {
    map[collectionId] = valid
  }
  writePipelineEntitiesMap(map)
}

export function clearPipelineEntitySelection(collectionId: string): void {
  const map = readPipelineEntitiesMap()
  if (!(collectionId in map)) return
  delete map[collectionId]
  writePipelineEntitiesMap(map)
}

export type PendingGraphBannerView = {
  title: string
  subtitle: string
  actionLabel: string
}

export function getPendingGraphBannerView(
  collectionName: string,
): PendingGraphBannerView {
  return {
    title: 'Grafo Pendiente',
    subtitle: `${collectionName} ya tiene documentos. Genera el grafo para habilitar la búsqueda.`,
    actionLabel: 'Generar grafo',
  }
}

export function clearActiveCollectionStorage(): void {
  const trackedId = localStorage.getItem(ACTIVE_COLLECTION_KEY)
  if (trackedId) clearPipelineEntitySelection(trackedId)
  localStorage.removeItem(ACTIVE_COLLECTION_KEY)
  localStorage.removeItem(MODAL_ETAPA_KEY)
  localStorage.removeItem(MODAL_NUEVA_SESSION_KEY)
  localStorage.removeItem(MODAL_CARGA_OPEN_KEY)
}

/** Limpia tracking local si coincide con la colección borrada/navegada. */
export function clearActiveCollectionStorageIfMatch(
  collectionId: string | null | undefined,
): void {
  if (!collectionId) return
  if (localStorage.getItem(ACTIVE_COLLECTION_KEY) === collectionId) {
    clearActiveCollectionStorage()
  }
}

/** Si la ruta es una colección concreta, no arrastrar tracking de otra. */
export function clearStaleActiveCollectionForPage(
  pageCollectionId: string | null | undefined,
): void {
  if (!pageCollectionId || pageCollectionId === 'nueva') return
  const tracked = localStorage.getItem(ACTIVE_COLLECTION_KEY)
  if (tracked && tracked !== pageCollectionId) {
    clearActiveCollectionStorage()
  }
}

/** Pipeline en espera de grafo solo para la colección que quedó marcada en localStorage. */
export function isAwaitingGraphForCollection(
  collectionId: string,
  processingStatus: string | undefined | null,
): boolean {
  if (!isAwaitingGraphGeneration(processingStatus)) return false
  return (
    localStorage.getItem(ACTIVE_COLLECTION_KEY) === collectionId &&
    localStorage.getItem(MODAL_ETAPA_KEY) === 'pipeline'
  )
}

/** Colección que gobierna el modal: la de la ruta; en ``nueva`` solo la sesión actual. */
export function resolveModalCollectionId(
  scopeCollectionId: string | null | undefined,
  sessionCollectionId: string | null,
): string | null {
  if (scopeCollectionId === 'nueva') {
    return sessionCollectionId
  }
  if (scopeCollectionId) {
    return scopeCollectionId
  }
  return sessionCollectionId
}

export function isGraphViewable(status: string | undefined | null): boolean {
  return status === 'graph_ready' || status === 'partial_error'
}

/** Enlace «Ver Grafo» solo cuando el backend expone el grafo. */
export function canShowGraphNavigation(
  processingStatus: string | undefined | null,
): boolean {
  return isGraphViewable(processingStatus)
}

/** Lista de documentos disponible en cualquier colección creada (con o sin grafo). */
export function canShowDocumentListNavigation(
  collectionId: string | null | undefined,
): boolean {
  return !!collectionId && collectionId !== 'nueva'
}

export type GraphUnavailableView = {
  title: string
  subtitle: string
  pending: boolean
}

/** Mensajes del visualizador de grafo según estado de la colección. */
export function getGraphUnavailableView(
  processingStatus: string | undefined | null,
): GraphUnavailableView {
  switch (processingStatus) {
    case 'idle':
      return {
        title: 'Aún no hay grafo para visualizar',
        subtitle:
          'Los documentos ya están en la colección. Genera el grafo para poder explorarlo aquí.',
        pending: false,
      }
    case 'processing_text':
      return {
        title: 'El grafo se está generando',
        subtitle:
          'Extracción de texto en curso. Vuelve a comprobarlo en unos momentos.',
        pending: true,
      }
    case 'processing_graph':
      return {
        title: 'El grafo se está generando',
        subtitle:
          'Construcción del grafo en curso. Vuelve a comprobarlo en unos momentos.',
        pending: true,
      }
    case 'awaiting_graph_confirmation':
      return {
        title: 'El grafo aún no está listo',
        subtitle:
          'Confirma la construcción del grafo desde la colección para visualizarlo aquí.',
        pending: false,
      }
    case 'cancelled':
      return {
        title: 'No hay grafo para visualizar',
        subtitle: 'Genera el grafo de nuevo desde la colección.',
        pending: false,
      }
    case 'error':
      return {
        title: 'No se pudo generar el grafo',
        subtitle:
          'Revisa el estado de la colección e inténtalo otra vez desde el buscador.',
        pending: false,
      }
    default:
      return {
        title: 'El grafo no está disponible',
        subtitle:
          'Vuelve a intentarlo más tarde o genera el grafo desde la colección.',
        pending: false,
      }
  }
}

export type CollectionProcessingSnapshot = {
  collectionId: string
  collectionName: string
  processingStatus: string
  textProgressTotal: number
  textProgressProcessed: number
  graphProgressTotal: number
  graphProgressProcessed: number
}

const PIPELINE_STAGE_LABELS: Record<string, string> = {
  processing_text: 'Extracción de Texto',
  processing_graph: 'Construcción del Grafo',
  awaiting_graph_confirmation: 'Confirmación de Grafo',
}

export type CollectionProgressFields = {
  processing_status?: string | null
  text_progress_total?: number
  text_progress_processed?: number
  graph_progress_total?: number
  graph_progress_processed?: number
}

/** Etapa + % para tarjetas de colección (p. ej. landing). */
export function getCollectionCardProgressLabel(
  collection: CollectionProgressFields,
): string | null {
  const status = collection.processing_status
  if (!status || !isPipelineInProgress(status)) return null

  const snapshot = snapshotFromCollectionApi(collection, '')
  const stage = PIPELINE_STAGE_LABELS[snapshot.processingStatus] ?? 'Procesando'
  const overall = getOverallPipelinePercent(snapshot)

  if (overall !== null) {
    return `${stage} · ${overall}%`
  }
  return stage
}

export function snapshotFromCollectionApi(
  data: CollectionProgressFields & { name?: string },
  collectionId: string,
): CollectionProcessingSnapshot {
  const rawStatus = data.processing_status ?? 'idle'
  const processingStatus = rawStatus === 'queued' ? 'idle' : rawStatus
  return {
    collectionId,
    collectionName: data.name ?? 'Colección',
    processingStatus,
    textProgressTotal: data.text_progress_total ?? 0,
    textProgressProcessed: data.text_progress_processed ?? 0,
    graphProgressTotal: data.graph_progress_total ?? 0,
    graphProgressProcessed: data.graph_progress_processed ?? 0,
  }
}

export function getStepProgressPercent(
  processed: number,
  total: number,
): number {
  if (total <= 0) return 0
  return Math.min(100, Math.round((processed / total) * 100))
}

/** Progreso global del pipeline (extracción ≈ 0–50 %, grafo ≈ 50–100 %). */
export function getOverallPipelinePercent(
  snapshot: CollectionProcessingSnapshot,
): number | null {
  switch (snapshot.processingStatus) {
    case 'awaiting_graph_confirmation':
      return 50
    case 'processing_text': {
      if (snapshot.textProgressTotal <= 0) return null
      const step = getStepProgressPercent(
        snapshot.textProgressProcessed,
        snapshot.textProgressTotal,
      )
      return Math.round(step * 0.5)
    }
    case 'processing_graph': {
      if (snapshot.graphProgressTotal <= 0) return 50
      const step = getStepProgressPercent(
        snapshot.graphProgressProcessed,
        snapshot.graphProgressTotal,
      )
      return 50 + Math.round(step * 0.5)
    }
    case 'graph_ready':
      return 100
    default:
      return null
  }
}

export function formatPipelineProgressPercent(percent: number | null): string {
  return percent === null ? '—' : `${percent}%`
}

export type PipelineProgressDisplay = {
  overallPercent: number | null
  textCardPercentLabel: string
  textCardBarWidth: number
  graphCardPercentLabel: string
  graphCardBarWidth: number
}

/** Progreso del modal: barras por etapa (0–100 % cada una); overallPercent sigue la escala global. */
export function getPipelineProgressDisplay(
  snapshot: CollectionProcessingSnapshot,
): PipelineProgressDisplay {
  const overall = getOverallPipelinePercent(snapshot)
  const overallLabel = formatPipelineProgressPercent(overall)
  const textStep = getStepProgressPercent(
    snapshot.textProgressProcessed,
    snapshot.textProgressTotal,
  )
  const graphStep = getStepProgressPercent(
    snapshot.graphProgressProcessed,
    snapshot.graphProgressTotal,
  )

  switch (snapshot.processingStatus) {
    case 'processing_text':
      return {
        overallPercent: overall,
        textCardPercentLabel: formatPipelineProgressPercent(textStep),
        textCardBarWidth: textStep,
        graphCardPercentLabel: '—',
        graphCardBarWidth: 0,
      }
    case 'awaiting_graph_confirmation':
      return {
        overallPercent: overall,
        textCardPercentLabel: 'Completada',
        textCardBarWidth: 100,
        graphCardPercentLabel: '—',
        graphCardBarWidth: 0,
      }
    case 'processing_graph':
      return {
        overallPercent: overall,
        textCardPercentLabel: 'Completada',
        textCardBarWidth: 100,
        graphCardPercentLabel: formatPipelineProgressPercent(graphStep),
        graphCardBarWidth: graphStep,
      }
    case 'graph_ready':
      return {
        overallPercent: overall,
        textCardPercentLabel: 'Completada',
        textCardBarWidth: 100,
        graphCardPercentLabel: '100%',
        graphCardBarWidth: 100,
      }
    case 'partial_error':
    case 'error':
      return {
        overallPercent: overall,
        textCardPercentLabel: 'Completada',
        textCardBarWidth: 100,
        graphCardPercentLabel: formatPipelineProgressPercent(graphStep),
        graphCardBarWidth: graphStep,
      }
    default:
      return {
        overallPercent: overall,
        textCardPercentLabel: overallLabel,
        textCardBarWidth: overall ?? 0,
        graphCardPercentLabel: overallLabel,
        graphCardBarWidth: overall ?? 0,
      }
  }
}

export type ProcessingBannerView = {
  title: string
  subtitle: string
  progressPercent: number | null
  progressCaption: string
}

export function getProcessingBannerView(
  snapshot: CollectionProcessingSnapshot,
  options?: { showCollectionName?: boolean },
): ProcessingBannerView {
  const stageLabel =
    PIPELINE_STAGE_LABELS[snapshot.processingStatus] ?? 'Procesando'
  const showName = options?.showCollectionName === true

  const title = showName
    ? `«${snapshot.collectionName}» — ${stageLabel}`
    : stageLabel

  let subtitle: string
  let progressCaption: string
  const overall = getOverallPipelinePercent(snapshot)

  if (snapshot.processingStatus === 'awaiting_graph_confirmation') {
    subtitle = 'Revisa qué documentos incluir antes de crear el grafo.'
    progressCaption = 'Paso 2 de 2'
  } else if (snapshot.processingStatus === 'processing_text') {
    subtitle =
      snapshot.textProgressTotal > 0
        ? `${snapshot.textProgressProcessed} de ${snapshot.textProgressTotal} documentos`
        : 'Preparando extracción…'
    progressCaption =
      overall !== null ? formatPipelineProgressPercent(overall) : '—'
  } else if (snapshot.processingStatus === 'processing_graph') {
    subtitle =
      snapshot.graphProgressTotal > 0
        ? `${snapshot.graphProgressProcessed} de ${snapshot.graphProgressTotal} pasos del grafo`
        : 'Construyendo relaciones…'
    progressCaption =
      overall !== null ? formatPipelineProgressPercent(overall) : '—'
  } else {
    subtitle = 'Procesando en segundo plano'
    progressCaption =
      overall !== null ? formatPipelineProgressPercent(overall) : '—'
  }

  return {
    title,
    subtitle,
    progressPercent: overall,
    progressCaption,
  }
}
