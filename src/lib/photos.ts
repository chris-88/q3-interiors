/**
 * Customer photos are made ready in the browser before upload: decoded (turned upright from the
 * camera's orientation), scaled to at most 2048px on the long edge and re-encoded as a JPEG by a
 * canvas. A canvas has no metadata, so Exif (with GPS), XMP and the like are gone before anything
 * is sent; the server strips again regardless. A 320px thumbnail is made the same way.
 *
 * HEIC/HEIF (iPhone): when a photo is chosen from the library with `accept="image/*"`, iOS
 * hands the page a JPEG copy. Where the browser itself can decode HEIC (Safari) it is converted
 * here too. Where it cannot (most other browsers), the photo is refused with a plain message.
 */

export const MAX_PHOTOS = 8
export const PHOTO_EDGE = 2048
export const THUMB_EDGE = 320
/** Stay well under the server's 2 MiB cap. */
export const PHOTO_TARGET_BYTES = 1_500_000
export const THUMB_TARGET_BYTES = 38_000

export class PhotoReadError extends Error {
  constructor() {
    super('This photo could not be read')
    this.name = 'PhotoReadError'
  }
}

/** Scale (never up) so the long edge is at most `edge`. */
export function fitWithin(width: number, height: number, edge: number) {
  const scale = Math.min(1, edge / Math.max(width, height))
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

async function decode(file: Blob): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    throw new PhotoReadError()
  }
}

async function encode(bitmap: ImageBitmap, edge: number, quality: number): Promise<Blob> {
  const size = fitWithin(bitmap.width, bitmap.height, edge)
  const canvas = document.createElement('canvas')
  canvas.width = size.width
  canvas.height = size.height
  const context = canvas.getContext('2d')
  if (!context) throw new PhotoReadError()
  context.drawImage(bitmap, 0, 0, size.width, size.height)
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', quality),
  )
  if (!blob) throw new PhotoReadError()
  return blob
}

export type PreparedPhoto = { photo: Blob; thumb: Blob }

export async function preparePhoto(file: Blob): Promise<PreparedPhoto> {
  const bitmap = await decode(file)
  try {
    let photo = await encode(bitmap, PHOTO_EDGE, 0.82)
    if (photo.size > PHOTO_TARGET_BYTES) photo = await encode(bitmap, 1600, 0.72)
    if (photo.size > PHOTO_TARGET_BYTES) photo = await encode(bitmap, 1200, 0.65)
    let thumb = await encode(bitmap, THUMB_EDGE, 0.7)
    if (thumb.size > THUMB_TARGET_BYTES) thumb = await encode(bitmap, 240, 0.55)
    return { photo, thumb }
  } finally {
    bitmap.close()
  }
}
