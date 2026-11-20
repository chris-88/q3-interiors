// Small WebCrypto helpers (work in Deno and Node 24).

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const b64 = value.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(b64.padEnd(b64.length + ((4 - (b64.length % 4)) % 4), '='))
  const out = new Uint8Array(new ArrayBuffer(binary.length))
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i)
  return out
}

export function randomToken(bytes = 32): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(bytes)))
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

/** PKCE S256 challenge for a verifier. */
export async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return toBase64Url(new Uint8Array(digest))
}

async function importKey(keyBase64: string): Promise<CryptoKey> {
  const raw = fromBase64Url(keyBase64.trim())
  if (raw.length !== 32) throw new Error('TOKEN_ENCRYPTION_KEY must be 32 bytes, base64')
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

/** AES-256-GCM. Output: `v1.<iv>.<ciphertext>` in base64url. */
export async function encryptSecret(plaintext: string, keyBase64: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    await importKey(keyBase64),
    new TextEncoder().encode(plaintext),
  )
  return `v1.${toBase64Url(iv)}.${toBase64Url(new Uint8Array(ct))}`
}

export async function decryptSecret(ciphertext: string, keyBase64: string): Promise<string> {
  const [version, iv, ct] = ciphertext.split('.')
  if (version !== 'v1' || !iv || !ct) throw new Error('Unrecognised ciphertext')
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64Url(iv) },
    await importKey(keyBase64),
    fromBase64Url(ct),
  )
  return new TextDecoder().decode(plain)
}
