// HTML to PDF through Gotenberg (Chromium), internal to the stack at Q3_PDF_URL; never public.
// The document goes as index.html with its Roboto files beside it, so Chromium needs no network
// (the wordmark is inline SVG) and JavaScript is off in the service.
import { QUOTE_FONT_FILES } from './quote-document.ts'

export type PdfMaker = (html: string) => Promise<Uint8Array>

export function createGotenberg(opts: {
  url: string
  /** Where the Roboto files are served (the site's /quote/ folder). */
  fontBase: string
  fetch?: typeof fetch
}): PdfMaker {
  const doFetch = opts.fetch ?? fetch
  let fonts: Map<string, ArrayBuffer> | null = null
  return async (html) => {
    if (!fonts) {
      const loaded = new Map<string, ArrayBuffer>()
      for (const name of QUOTE_FONT_FILES) {
        const res = await doFetch(`${opts.fontBase}${name}`, {
          signal: AbortSignal.timeout(10_000),
        })
        if (!res.ok) throw new Error(`font ${name} ${res.status}`)
        loaded.set(name, await res.arrayBuffer())
      }
      fonts = loaded
    }
    const form = new FormData()
    form.append('files', new Blob([html], { type: 'text/html' }), 'index.html')
    for (const [name, bytes] of fonts)
      form.append('files', new Blob([bytes], { type: 'font/woff2' }), name)
    form.append('preferCssPageSize', 'true')
    form.append('printBackground', 'true')
    const res = await doFetch(`${opts.url}/forms/chromium/convert/html`, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(40_000),
    })
    if (!res.ok) {
      await res.body?.cancel()
      throw new Error(`pdf ${res.status}`)
    }
    return new Uint8Array(await res.arrayBuffer())
  }
}
