// Hand-built JPEG byte streams for the image checks: structurally valid (markers, lengths, frame
// and scan headers, end marker) without real image data, which the server never decodes.

const bytes = (...parts: (number[] | string)[]) =>
  Uint8Array.from(
    parts.flatMap((p) => (typeof p === 'string' ? [...p].map((c) => c.charCodeAt(0)) : p)),
  )

const be16 = (n: number) => [(n >> 8) & 0xff, n & 0xff]

const segment = (marker: number, payload: number[]) => [
  0xff,
  marker,
  ...be16(payload.length + 2),
  ...payload,
]

const JFIF = segment(0xe0, [...bytes('JFIF\0'), 1, 1, 0, 0, 1, 0, 1, 0, 0])

/** An Exif APP1 with a GPS IFD pointer (tag 0x8825) and a latitude reference, as phones write. */
// prettier-ignore
export const EXIF_GPS = segment(0xe1, [
  ...bytes('Exif\0\0'),
  // TIFF header, big endian, IFD0 at offset 8 with one entry: GPSInfo -> offset 26.
  ...bytes('MM'), 0, 42, 0, 0, 0, 8,
  0, 1, 0x88, 0x25, 0, 4, 0, 0, 0, 1, 0, 0, 0, 26, 0, 0, 0, 0,
  // GPS IFD: one entry, GPSLatitudeRef = "N".
  0, 1, 0, 1, 0, 2, 0, 0, 0, 2, ...bytes('N\0'), 0, 0, 0, 0, 0, 0,
])

const XMP = segment(0xe1, [...bytes('http://ns.adobe.com/xap/1.0/\0<x:xmpmeta/>')])
const COMMENT = segment(0xfe, [...bytes('taken at 53.35N 6.26W')])

const sof = (width: number, height: number) =>
  segment(0xc0, [8, ...be16(height), ...be16(width), 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1])
const SOS = segment(0xda, [3, 1, 0, 2, 0x11, 3, 0x11, 0, 0x3f, 0])
const SCAN = [0x12, 0x34, 0xff, 0x00, 0x56] // stuffed 0xFF00 inside entropy data
const EOI = [0xff, 0xd9]

export function jpeg(
  opts: { width?: number; height?: number; exif?: boolean; padTo?: number } = {},
) {
  const width = opts.width ?? 800
  const height = opts.height ?? 600
  const head = [
    0xff,
    0xd8,
    ...JFIF,
    ...(opts.exif ? [...EXIF_GPS, ...XMP, ...COMMENT] : []),
    ...sof(width, height),
    ...SOS,
  ]
  const pad = Math.max(0, (opts.padTo ?? 0) - head.length - SCAN.length - EOI.length)
  return Uint8Array.from([...head, ...SCAN, ...new Array<number>(pad).fill(0x11), ...EOI])
}

export const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])

export function toBase64(data: Uint8Array): string {
  let binary = ''
  for (const b of data) binary += String.fromCharCode(b)
  return btoa(binary)
}
