/** Estados en los que el pipeline sigue activo en backend. */
export const PIPELINE_RUNNING_STATUSES = new Set([
  'processing_text',
  'processing_graph',
])

/** Incluye pausa por confirmación de grafo y colecciones en cola. */
export const PIPELINE_IN_PROGRESS_STATUSES = new Set([
  'processing_text',
  'processing_graph',
  'awaiting_graph_confirmation',
  'queued',
])

export const ACTIVE_COLLECTION_KEY = 'active_collection_id'
export const MODAL_ETAPA_KEY = 'modal_carga_etapa'

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

export type PendingGraphBannerView = {
  title: string
  subtitle: string
  actionLabel: string
}

export function getPendingGraphBannerView(
  collectionName: string,
): PendingGraphBannerView {
  return {
    title: `${collectionName} — Grafo pendiente`,
    subtitle:
      'Los documentos ya están cargados. Genera el grafo para habilitar la búsqueda.',
    actionLabel: 'Clic para generar grafo',
  }
}

export function clearActiveCollectionStorage(): void {
  localStorage.removeItem(ACTIVE_COLLECTION_KEY)
  localStorage.removeItem(MODAL_ETAPA_KEY)
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
  processing_text: 'Extracción de texto',
  processing_graph: 'Construcción del grafo',
  awaiting_graph_confirmation: 'Confirmación de grafo',
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
  const processingStatus = rawStatus
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
    default:
      return 0
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
  const showName = options?.showCollectionName !== false

  const title = showName
    ? `Se está procesando «${snapshot.collectionName}» — ${stageLabel}`
    : stageLabel

  let subtitle: string
  let progressCaption: string
  const overall = getOverallPipelinePercent(snapshot)

  if (snapshot.processingStatus === 'awaiting_graph_confirmation') {
    subtitle =
      'El grafo se creará solo con los documentos que sí pasaron la extracción.'
    progressCaption = 'Confirmación requerida'
  } else if (snapshot.processingStatus === 'processing_text') {
    const step = getStepProgressPercent(
      snapshot.textProgressProcessed,
      snapshot.textProgressTotal,
    )
    subtitle = `Extracción de documentos · ${step}%`
    progressCaption =
      overall !== null ? `${overall}% del pipeline` : 'Calculando progreso…'
  } else if (snapshot.processingStatus === 'processing_graph') {
    const step = getStepProgressPercent(
      snapshot.graphProgressProcessed,
      snapshot.graphProgressTotal,
    )
    subtitle = `Construcción del grafo · ${step}%`
    progressCaption =
      overall !== null ? `${overall}% del pipeline` : 'Calculando progreso…'
  } else {
    subtitle = 'Procesando en segundo plano'
    progressCaption = overall !== null ? `${overall}%` : '—'
  }

  return {
    title,
    subtitle,
    progressPercent: overall,
    progressCaption,
  }
}
