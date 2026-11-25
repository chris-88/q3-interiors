// Server-side checks for customer photos. The browser resizes and re-encodes every photo to a
// baseline JPEG (which drops Exif, GPS and other metadata); the server does not trust that. It
// accepts only bytes that parse as a JPEG with sensible dimensions, and rewrites the header so
// that no application segment except JFIF (APP0) and no comment survives: whatever metadata a
// modified client sends (Exif with GPS, XMP, ICC, maker notes) is dropped before storage.

export const PHOTO_MAX_BYTES = 2 * 1024 * 1024
export const THUMB_MAX_BYTES = 40_000
export const PHOTO_MAX_EDGE = 4096

export type JpegCheck =
  | { ok: true; bytes: Uint8Array; width: number; height: number; stripped: number }
  | { ok: false; reason: 'not_jpeg' | 'malformed' | 'too_large' | 'dimensions' }

// Start-of-frame markers carry the dimensions (not DHT C4, JPG C8 or DAC CC).
const SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf])

/** Parse, size-check and strip metadata. `maxBytes` applies to the input. */
export function inspectJpeg(input: Uint8Array, maxBytes = PHOTO_MAX_BYTES): JpegCheck {
  if (input.length > maxBytes) return { ok: false, reason: 'too_large' }
  if (input.length < 4 || input[0] !== 0xff || input[1] !== 0xd8 || input[2] !== 0xff)
    return { ok: false, reason: 'not_jpeg' }
  const kept: Uint8Array[] = [input.subarray(0, 2)]
  let i = 2
  let width = 0
  let height = 0
  let stripped = 0
  while (i < input.length) {
    if (input[i] !== 0xff) return { ok: false, reason: 'malformed' }
    // Fill bytes before a marker are allowed.
    while (input[i] === 0xff && i < input.length) i += 1
    const marker = input[i]
    i += 1
    if (marker === undefined) return { ok: false, reason: 'malformed' }
    if (marker === 0xd9) return { ok: false, reason: 'malformed' } // EOI before any scan
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue // no length
    if (i + 2 > input.length) return { ok: false, reason: 'malformed' }
    const length = ((input[i] ?? 0) << 8) | (input[i + 1] ?? 0)
    if (length < 2 || i + length > input.length) return { ok: false, reason: 'malformed' }
    const segment = input.subarray(i - 2, i + length)
    if (SOF.has(marker)) {
      if (length < 7) return { ok: false, reason: 'malformed' }
      height = ((input[i + 3] ?? 0) << 8) | (input[i + 4] ?? 0)
      width = ((input[i + 5] ?? 0) << 8) | (input[i + 6] ?? 0)
    }
    if (marker === 0xda) {
      // Start of scan: the compressed data and everything after it is kept as is; it must end
      // with EOI, and a frame header must have come first.
      if (!width || !height) return { ok: false, reason: 'malformed' }
      const last = input.length
      if (input[last - 2] !== 0xff || input[last - 1] !== 0xd9)
        return { ok: false, reason: 'malformed' }
      if (width > PHOTO_MAX_EDGE || height > PHOTO_MAX_EDGE)
        return { ok: false, reason: 'dimensions' }
      kept.push(input.subarray(i - 2))
      const total = kept.reduce((n, part) => n + part.length, 0)
      const bytes = new Uint8Array(total)
      let at = 0
      for (const part of kept) {
        bytes.set(part, at)
        at += part.length
      }
      return { ok: true, bytes, width, height, stripped }
    }
    // APP1..APP15 (Exif, XMP, ICC, Adobe, maker data) and comments are metadata: dropped.
    if ((marker >= 0xe1 && marker <= 0xef) || marker === 0xfe) stripped += 1
    else kept.push(segment)
    i += length
  }
  return { ok: false, reason: 'malformed' }
}

/** Does this JPEG still carry Exif (and so possibly GPS)? Used by tests and as a final guard. */
export function hasExif(bytes: Uint8Array): boolean {
  for (let i = 0; i + 9 < bytes.length; i += 1) {
    if (bytes[i] === 0xff && bytes[i + 1] === 0xe1) {
      const tag = String.fromCharCode(...bytes.subarray(i + 4, i + 8))
      if (tag === 'Exif') return true
    }
    if (bytes[i] === 0xff && bytes[i + 1] === 0xda) return false
  }
  return false
}

/** Strict base64 to bytes; null when it is not base64 or decodes to more than `maxBytes`. */
export function decodeBase64(text: string, maxBytes: number): Uint8Array | null {
  if (text.length > Math.ceil((maxBytes * 4) / 3) + 4) return null
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(text) || text.length % 4 !== 0) return null
  try {
    const binary = atob(text)
    if (binary.length > maxBytes) return null
    const out = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i)
    return out
  } catch {
    return null
  }
}
