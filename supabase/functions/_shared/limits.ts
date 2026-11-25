// Per-address abuse limits for the public functions. The address is never stored: only an
// HMAC-SHA256 of it, keyed with the worker secret (the database computes the same hash for
// enquiry submissions, see private.address_hash).

/**
 * The client address: Cloudflare's cf-connecting-ip (the origin is only reachable through the
 * tunnel, so it is trustworthy), else the first x-forwarded-for hop, else one shared bucket.
 */
export function clientAddress(headers: Headers): string {
  const cf = headers.get('cf-connecting-ip')?.trim()
  if (cf) return cf
  const first = headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  if (first) return first
  return 'shared'
}

export async function addressHash(address: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(address))
  return Array.from(new Uint8Array(mac), (b) => b.toString(16).padStart(2, '0')).join('')
}

export type Bucket = 'booking_write' | 'booking_read'

/** Which bucket an action uses and the key that makes a retry of it free. */
export function bucketFor(
  action: string,
  enquiryId: string,
  body: Record<string, unknown>,
): { bucket: Bucket; idemKey: string | null } {
  switch (action) {
    case 'book':
      return { bucket: 'booking_write', idemKey: `book:${String(body.idempotencyKey ?? '')}` }
    case 'reschedule':
      return { bucket: 'booking_write', idemKey: `move:${enquiryId}:${String(body.start ?? '')}` }
    case 'cancel':
      return { bucket: 'booking_write', idemKey: `cancel:${enquiryId}` }
    case 'request_contact':
      return { bucket: 'booking_write', idemKey: `contact:${enquiryId}` }
    case 'site_details':
    case 'update_details':
      return { bucket: 'booking_write', idemKey: null }
    default:
      return { bucket: 'booking_read', idemKey: null }
  }
}

/** A limiter bound to one request's address. Resolves true when the action may go ahead. */
export type Limiter = (bucket: Bucket, idemKey: string | null) => Promise<boolean>
