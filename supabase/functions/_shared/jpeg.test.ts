import { describe, expect, it } from 'vitest'
import { PHOTO_MAX_BYTES, decodeBase64, hasExif, inspectJpeg } from './jpeg.ts'
import { PNG, jpeg, toBase64 } from './testing/jpeg-fixtures.ts'

describe('photo checks', () => {
  it('accepts a JPEG and reads its size', () => {
    const result = inspectJpeg(jpeg({ width: 1600, height: 1200 }))
    expect(result).toMatchObject({ ok: true, width: 1600, height: 1200, stripped: 0 })
  })

  it('strips Exif with GPS, XMP and comments, keeping the image', () => {
    const input = jpeg({ exif: true })
    expect(hasExif(input)).toBe(true)
    const result = inspectJpeg(input)
    if (!result.ok) throw new Error(result.reason)
    expect(result.stripped).toBe(3)
    expect(hasExif(result.bytes)).toBe(false)
    const text = new TextDecoder('latin1').decode(result.bytes)
    expect(text).not.toContain('GPS')
    expect(text).not.toContain('xmpmeta')
    expect(text).not.toContain('53.35N')
    // What is left is exactly the clean file.
    expect(result.bytes).toEqual(jpeg())
  })

  it('refuses anything that is not a whole JPEG', () => {
    expect(inspectJpeg(PNG)).toEqual({ ok: false, reason: 'not_jpeg' })
    expect(inspectJpeg(new TextEncoder().encode('<svg onload=alert(1)>'))).toEqual({
      ok: false,
      reason: 'not_jpeg',
    })
    const whole = jpeg()
    expect(inspectJpeg(whole.subarray(0, whole.length - 2))).toEqual({
      ok: false,
      reason: 'malformed',
    })
    expect(inspectJpeg(whole.subarray(0, 30))).toEqual({ ok: false, reason: 'malformed' })
  })

  it('refuses oversized files and dimensions', () => {
    expect(inspectJpeg(jpeg({ padTo: PHOTO_MAX_BYTES + 1 }))).toEqual({
      ok: false,
      reason: 'too_large',
    })
    expect(inspectJpeg(jpeg({ width: 5000, height: 100 }))).toEqual({
      ok: false,
      reason: 'dimensions',
    })
    expect(inspectJpeg(jpeg(), 10)).toEqual({ ok: false, reason: 'too_large' })
  })

  it('decodes strict base64 only, within the limit', () => {
    const data = jpeg()
    expect(decodeBase64(toBase64(data), 1000)).toEqual(data)
    expect(decodeBase64('not base64!', 1000)).toBeNull()
    expect(decodeBase64(toBase64(data), 10)).toBeNull()
  })
})
