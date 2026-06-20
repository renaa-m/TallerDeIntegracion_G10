type CacheEntry = {
  promise: Promise<Response>
  timestamp: number
}

const cache = new Map<string, CacheEntry>()
const CACHE_TTL_MS = 2000

function safeClone(res: Response): Response {
  return typeof res.clone === 'function' ? res.clone() : res
}

export function fetchCollectionCached(
  url: string,
  headers: Record<string, string>,
): Promise<Response> {
  const now = Date.now()
  const existing = cache.get(url)

  if (existing && now - existing.timestamp < CACHE_TTL_MS) {
    return existing.promise.then(safeClone)
  }

  const promise = fetch(url, { headers })
  cache.set(url, { promise, timestamp: now })

  promise
    .catch(() => {})
    .finally(() => {
      setTimeout(() => {
        const entry = cache.get(url)
        if (entry && entry.timestamp === now) {
          cache.delete(url)
        }
      }, CACHE_TTL_MS)
    })

  return promise
}

export function clearCollectionFetchCache(): void {
  cache.clear()
}
