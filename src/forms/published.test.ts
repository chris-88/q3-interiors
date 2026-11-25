import publishedSql from '../../supabase/forms/published.sql?raw'
import { publishedForms } from './published'
import { publishedFormsSql } from './sql'

/**
 * Fingerprints of published form versions. A published version is immutable: if one of these
 * fails, you edited a version that customers have already answered. Revert it and add a new
 * version instead (see CLAUDE.md, "Form versions"). Add a line here when you publish.
 */
const PUBLISHED_FINGERPRINTS: Record<string, string> = {
  'enquiry@1': '5f53ee5b6d5cc79f0fce0781f21994cb881db34d2fa23a9bdcdb5ec90ff4098e',
  'site_details@1': 'd29862871f5a2f666231bbb981fb5244502a083116ab82b64506858271129eac',
  'enquiry@2': 'a47f0c45cf5e9363815b440f0c4b64e8fbbb96f5069998bfaff4951c4877eeda',
  'prepare@1': '0a6a8c2418d6d1dc8b6c7ebcda431b742c5e375f6b7d78355c51728809c58a6c',
}

async function fingerprint(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(value))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

describe('published form versions', () => {
  it('are unchanged since publication', async () => {
    for (const form of publishedForms) {
      const key = `${form.formId}@${form.version}`
      expect({ key, fingerprint: await fingerprint(form) }).toEqual({
        key,
        fingerprint: PUBLISHED_FINGERPRINTS[key],
      })
    }
  })

  it('are unique by form id and version', () => {
    const keys = publishedForms.map((f) => `${f.formId}@${f.version}`)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('match the SQL that seeds form_versions (run `npm run forms:sql` if this fails)', () => {
    expect(publishedSql).toBe(publishedFormsSql())
  })
})
