// The private `enquiry-photos` bucket, written only here, with the service role key that lives in
// the functions container (never in a browser). Calls go to the stack's own gateway inside the
// Docker network, not through Cloudflare.

export const PHOTO_BUCKET = 'enquiry-photos'

export interface PhotoStore {
  /** Store (or overwrite: a retried upload) one JPEG. Throws on failure. */
  put(path: string, bytes: Uint8Array): Promise<void>
  /** Remove files; missing files are not an error. Throws on failure. */
  remove(paths: string[]): Promise<void>
}

export function createPhotoStore(opts: { url: string; serviceKey: string }): PhotoStore {
  const headers = { Authorization: `Bearer ${opts.serviceKey}`, apikey: opts.serviceKey }
  const base = `${opts.url}/storage/v1/object/${PHOTO_BUCKET}`
  return {
    async put(path, bytes) {
      const res = await fetch(`${base}/${path}`, {
        method: 'POST',
        headers: { ...headers, 'content-type': 'image/jpeg', 'x-upsert': 'true' },
        body: new Uint8Array(bytes),
        signal: AbortSignal.timeout(20_000),
      })
      if (!res.ok) throw new Error(`storage put ${res.status}`)
      await res.body?.cancel()
    },
    async remove(paths) {
      if (paths.length === 0) return
      const res = await fetch(base, {
        method: 'DELETE',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify({ prefixes: paths }),
        signal: AbortSignal.timeout(20_000),
      })
      if (!res.ok) throw new Error(`storage remove ${res.status}`)
      await res.body?.cancel()
    },
  }
}

export const QUOTE_BUCKET = 'quotes'

/** The private `quotes` bucket: the PDFs the worker stores and the customer's page hands back. */
export interface QuoteFiles {
  /** Store (or overwrite: a retried send) one PDF. Throws on failure. */
  put(path: string, bytes: Uint8Array): Promise<void>
  /** The stored PDF, or null if it is missing. */
  get(path: string): Promise<Uint8Array | null>
}

export function createQuoteFiles(opts: { url: string; serviceKey: string }): QuoteFiles {
  const headers = { Authorization: `Bearer ${opts.serviceKey}`, apikey: opts.serviceKey }
  const object = `${opts.url}/storage/v1/object`
  return {
    async put(path, bytes) {
      const res = await fetch(`${object}/${QUOTE_BUCKET}/${path}`, {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/pdf', 'x-upsert': 'true' },
        body: new Uint8Array(bytes),
        signal: AbortSignal.timeout(20_000),
      })
      if (!res.ok) throw new Error(`storage put ${res.status}`)
      await res.body?.cancel()
    },
    async get(path) {
      const res = await fetch(`${object}/${QUOTE_BUCKET}/${path}`, {
        headers,
        signal: AbortSignal.timeout(20_000),
      })
      if (res.status === 400 || res.status === 404) {
        await res.body?.cancel()
        return null
      }
      if (!res.ok) throw new Error(`storage get ${res.status}`)
      return new Uint8Array(await res.arrayBuffer())
    },
  }
}
