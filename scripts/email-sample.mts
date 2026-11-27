// A sample customer email through the real sending path, to see it exactly as a customer would
// (Node 24 runs this TypeScript directly).
//
//   npm run email:sample -- estimate <address>             send the sample to <address>
//   npm run email:sample -- estimate --html <file>          write the HTML (and .txt) instead
//   npm run email:sample -- estimate --after-call <address> the estimate sent straight from a call
//   npm run email:sample -- visit-link <address>           "Book your site visit" (after a call)
//   npm run email:sample -- quote <address>                 a quote, its real PDF attached
//   npm run email:sample -- quote --pdf <file>              write the quote PDF
//   (--html <file> works with each of them; for a quote it also writes <file>-document.html)
//
// The quote PDF is made by the stack's Gotenberg (internal only), reached from this machine on
// its Docker network address.
//
// The customer is made up and nothing is written to the database. The business phone and the
// caveats wording are read from the live database (read only), so the email matches what a
// customer gets today. It is sent with the stack's Resend key (pass, for this run only, never
// printed) from the same sender as the stack, through the same renderer and mailer the worker
// uses. Its buttons point at sample links that only show "This link has expired".
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import { estimateRange } from '../supabase/functions/_shared/estimate.ts'
import { createGotenberg } from '../supabase/functions/_shared/pdf.ts'
import { longDate, renderQuoteDocument } from '../supabase/functions/_shared/quote-document.ts'
import { toLocal } from '../supabase/functions/_shared/time.ts'
import {
  addWorkingDays,
  QUOTE_VALID_WORKING_DAYS,
} from '../supabase/functions/_shared/working-days.ts'
import { createResendMailer, isSuppressed } from '../supabase/functions/_shared/email.ts'
import {
  renderEstimate,
  renderQuoteEmail,
  renderVisitLink,
  WORDING,
} from '../supabase/functions/_shared/messages.ts'
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

const [kind, ...args] = process.argv.slice(2)
if (kind !== 'estimate' && kind !== 'visit-link' && kind !== 'quote')
  fail(
    'usage: npm run email:sample -- estimate [--after-call] <address> | visit-link <address> (or --html <file> for the address)',
  )
const afterCall = args.includes('--after-call')
const rest = args.filter((a) => a !== '--after-call')
const htmlAt = rest.indexOf('--html')
const htmlFile = htmlAt >= 0 ? rest[htmlAt + 1] : undefined
const pdfAt = rest.indexOf('--pdf')
const pdfFile = pdfAt >= 0 ? rest[pdfAt + 1] : undefined
if (pdfAt >= 0 && kind !== 'quote') fail('--pdf is for a quote')
const address = htmlAt >= 0 || pdfAt >= 0 ? undefined : rest[0]
if (htmlAt >= 0 && !htmlFile) fail('--html needs a file name')
if (pdfAt >= 0 && !pdfFile) fail('--pdf needs a file name')
if (!htmlFile && !pdfFile && (!address || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)))
  fail('give the address to send the sample to')
if (address && isSuppressed(address)) fail(`${address} is a reserved test address`)

const range = estimateRange(10_000, 5)
const businessPhone = live('select contact_phone from public.business_details limit 1')
const caveatKey = afterCall ? 'estimate_call_caveats' : 'estimate_caveats'
// A made-up quote: the document, its PDF from Gotenberg, and the email.
const until = addWorkingDays(Date.now(), QUOTE_VALID_WORKING_DAYS)
const quoteDoc = {
  number: 'Q3-Q-0001',
  version: 1,
  sentOn: toLocal(Date.now()).date,
  validUntil: until,
  customerName: 'Ann Sample',
  jobAddress: '12 Example Road, Dublin 8',
  jobLine: 'Kitchen, Dublin 8',
  business: {
    legalName:
      live('select coalesce(legal_name, trading_name) from public.business_details limit 1') ??
      'Q3 Interiors',
    phone: businessPhone,
    // Files written out (to look at or share) show a made-up address; a sent sample the real one.
    email: address
      ? live('select contact_email from public.business_details limit 1')
      : 'hello@example.com',
  },
  included: [
    'Strip out the old kitchen',
    'New units and worktop',
    'Appliances fitted',
    'Tiled floor',
    'Plumbing',
    'Electrics and lighting',
    'Plastering',
    'Painting',
  ],
  excluded: [
    'Extra work found once the job is opened up',
    'Appliances',
    'Planning or certification fees',
  ],
  note: 'The existing window stays; the radiator moves to the back wall.',
  price: 10_200,
  depositPercent: 10,
  depositEur: 1_020,
  terms: (
    live(`select body from public.message_blocks where key = 'quote_terms'`) ??
    WORDING.quote_terms.default
  ).replace('{date}', longDate(until)),
  fontBase: '',
}

function gotenbergUrl(): string {
  if (process.env.Q3_PDF_URL) return process.env.Q3_PDF_URL
  try {
    const ip = execFileSync(
      'docker',
      [
        'inspect',
        '-f',
        '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}',
        'q3-interiors-gotenberg-1',
      ],
      { encoding: 'utf8' },
    ).trim()
    if (ip) return `http://${ip}:3000`
  } catch {
    // fall through
  }
  fail('could not find the Gotenberg container (set Q3_PDF_URL)')
}

async function quotePdf(): Promise<Uint8Array> {
  const make = createGotenberg({
    url: gotenbergUrl(),
    fontBase: '',
    // The Roboto files from the repo's public/quote/ instead of the site.
    fetch: (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      if (!url.startsWith('http')) return new Response(fs.readFileSync(`public/quote/${url}`))
      return fetch(input, init)
    }) as typeof fetch,
  })
  return make(renderQuoteDocument(quoteDoc))
}

const message =
  kind === 'quote'
    ? renderQuoteEmail({
        customerName: 'Ann Sample',
        workAt: quoteDoc.jobAddress,
        price: quoteDoc.price,
        goodUntil: longDate(until),
        version: 1,
        viewUrl: `${SITE_URL}/#/quote/sample-link-not-active/00000000-0000-4000-8000-000000000000`,
        depositUrl: `${SITE_URL}/#/quote/sample-link-not-active/00000000-0000-4000-8000-000000000000/deposit`,
        changeUrl: `${SITE_URL}/#/quote/sample-link-not-active/00000000-0000-4000-8000-000000000000/change`,
        businessPhone,
        privacyUrl: `${SITE_URL}/#/privacy`,
        siteUrl: SITE_URL,
      })
    : kind === 'visit-link'
      ? renderVisitLink({
          customerName: 'Ann Sample',
          bookUrl: `${SITE_URL}/#/book/sample-link-not-active?visit=1`,
          businessPhone,
          privacyUrl: `${SITE_URL}/#/privacy`,
          siteUrl: SITE_URL,
        })
      : renderEstimate({
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
            live(`select body from public.message_blocks where key = '${caveatKey}'`) ??
            WORDING[caveatKey].default,
          quoteUrl: `${SITE_URL}/#/estimate/sample-link-not-active/00000000-0000-4000-8000-000000000000`,
          businessPhone,
          privacyUrl: `${SITE_URL}/#/privacy`,
          siteUrl: SITE_URL,
          after: afterCall ? 'call' : 'visit',
        })

if (pdfFile) {
  fs.writeFileSync(pdfFile, await quotePdf())
  console.log(`email:sample: wrote ${pdfFile}`)
}
if (htmlFile) {
  fs.writeFileSync(htmlFile, message.html)
  fs.writeFileSync(htmlFile.replace(/\.html?$/, '') + '.txt', message.text)
  if (kind === 'quote')
    fs.writeFileSync(
      htmlFile.replace(/\.html?$/, '') + '-document.html',
      renderQuoteDocument({ ...quoteDoc, fontBase: `${SITE_URL}/quote/` }),
    )
  console.log(`email:sample: wrote ${htmlFile} (subject "${message.subject}")`)
} else if (address) {
  const mailer = createResendMailer({ apiKey: pass('infra/q3-interiors/SMTP_PASS'), from: FROM })
  const id = await mailer.send({
    to: address,
    subject: `${message.subject} (sample)`,
    text: message.text,
    html: message.html,
    idempotencyKey: `sample:${kind}:${Date.now()}`,
    ...(kind === 'quote'
      ? { attachments: [{ filename: 'Q3-Q-0001.pdf', content: await quotePdf() }] }
      : {}),
  })
  console.log(`email:sample: sent "${message.subject} (sample)" to ${address} (${id ?? 'no id'})`)
}
