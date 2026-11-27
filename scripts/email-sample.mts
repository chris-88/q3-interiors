// A sample customer email through the real sending path, to see it exactly as a customer would
// (Node 24 runs this TypeScript directly).
//
//   npm run email:sample -- estimate <address>             send the sample to <address>
//   npm run email:sample -- estimate --html <file>          write the HTML (and .txt) instead
//
// The customer is made up and nothing is written to the database. The business phone and the
// caveats wording are read from the live database (read only), so the email matches what a
// customer gets today. It is sent with the stack's Resend key (pass, for this run only, never
// printed) from the same sender as the stack, through the same renderer and mailer the worker
// uses. Its "Get my quote" button points at a sample link that only shows "This link has expired".
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import { estimateRange } from '../supabase/functions/_shared/estimate.ts'
import { createResendMailer, isSuppressed } from '../supabase/functions/_shared/email.ts'
import { renderEstimate, WORDING } from '../supabase/functions/_shared/messages.ts'
import { SITE_URL } from '../supabase/functions/_shared/site.ts'

const FROM = 'Q3 Interiors <bookings@q3interiors.ie>'

function fail(message: string): never {
  console.error(`email:sample: ${message}`)
  process.exit(1)
}

function pass(name: string): string {
  try {
    return execFileSync('pass', ['show', name], { encoding: 'utf8' }).split('\n')[0]?.trim() ?? ''
  } catch {
    fail(`could not read ${name} from pass`)
  }
}

/** One value from the live database, read only; null if it is not set or cannot be read. */
function live(sql: string): string | null {
  try {
    const url = pass('env/q3-interiors/DATABASE_URL')
    const out = execFileSync('psql', [url, '-X', '-q', '-A', '-t', '-c', sql], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    return out || null
  } catch {
    return null
  }
}

const [kind, ...rest] = process.argv.slice(2)
if (kind !== 'estimate')
  fail('usage: npm run email:sample -- estimate <address> | estimate --html <file>')
const htmlAt = rest.indexOf('--html')
const htmlFile = htmlAt >= 0 ? rest[htmlAt + 1] : undefined
const address = htmlAt >= 0 ? undefined : rest[0]
if (htmlAt >= 0 && !htmlFile) fail('--html needs a file name')
if (!htmlFile && (!address || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)))
  fail('give the address to send the sample to')
if (address && isSuppressed(address)) fail(`${address} is a reserved test address`)

const range = estimateRange(10_000, 5)
const message = renderEstimate({
  customerName: 'Ann Sample',
  workItems: [
    'Strip out the old kitchen',
    'New units and worktop',
    'Tiled floor',
    'Plastering',
    'Painting',
  ],
  note: 'Keep the existing window and move the radiator to the back wall.',
  low: range.low,
  high: range.high,
  caveats:
    live(`select body from public.message_blocks where key = 'estimate_caveats'`) ??
    WORDING.estimate_caveats.default,
  quoteUrl: `${SITE_URL}/#/estimate/sample-link-not-active/00000000-0000-4000-8000-000000000000`,
  businessPhone: live('select contact_phone from public.business_details limit 1'),
  privacyUrl: `${SITE_URL}/#/privacy`,
  siteUrl: SITE_URL,
})

if (htmlFile) {
  fs.writeFileSync(htmlFile, message.html)
  fs.writeFileSync(htmlFile.replace(/\.html?$/, '') + '.txt', message.text)
  console.log(`email:sample: wrote ${htmlFile} (subject "${message.subject}")`)
} else if (address) {
  const mailer = createResendMailer({ apiKey: pass('infra/q3-interiors/SMTP_PASS'), from: FROM })
  const id = await mailer.send({
    to: address,
    subject: `${message.subject} (sample)`,
    text: message.text,
    html: message.html,
    idempotencyKey: `sample:estimate:${Date.now()}`,
  })
  console.log(`email:sample: sent "${message.subject} (sample)" to ${address} (${id ?? 'no id'})`)
}
