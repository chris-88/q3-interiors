// The quote as a document: one renderer for the staff preview, the customer's view and the PDF
// (Gotenberg renders this same HTML with Chromium). A4, brand guide v2: the wordmark, black and
// white, Roboto. Plain HTML and CSS, no script.
import { formatEuro } from './estimate.ts'
import { WORDMARK_SVG } from './wordmark.ts'

export const QUOTE_SIGN_OFF = 'Chris Quinn, Q3 Interiors'
export const QUOTE_CHANGES_LINE =
  'If we find something once work starts, we ring you first. Nothing extra is done until you’ve agreed the price.'

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** A calendar date (YYYY-MM-DD) as "Fri 18 Dec 2026", the same as private.long_date in SQL. */
export function longDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  if (!y || !m || !d) return date
  const t = new Date(Date.UTC(y, m - 1, d))
  return `${DAYS[t.getUTCDay()]} ${d} ${MONTHS[m - 1]} ${y}`
}

/** The deposit line, e.g. "A 10% deposit of €1,020 books your start date. …" */
export function depositLine(percent: number, euro: number): string {
  return `A ${percent}% deposit of ${formatEuro(euro)} books your start date. We confirm the date once the deposit is in.`
}

export type QuoteDocumentInput = {
  number: string
  version: number
  /** The Irish date it was sent (YYYY-MM-DD). */
  sentOn: string
  /** YYYY-MM-DD */
  validUntil: string
  customerName: string
  /** The job's address, else null (the project and area are shown instead). */
  jobAddress: string | null
  jobLine: string | null
  business: { legalName: string | null; phone: string | null; email: string | null }
  included: string[]
  excluded: string[]
  note: string | null
  price: number
  depositPercent: number
  depositEur: number
  /** The terms paragraph as sent. */
  terms: string
  /**
   * Where the Roboto files are: '' for the PDF (sent to Gotenberg beside the HTML), else the
   * site's `/quote/` folder (e.g. https://book.q3interiors.ie/quote/).
   */
  fontBase: string
}

function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

const FONT_WEIGHTS = [400, 500, 700] as const
export const QUOTE_FONT_FILES = FONT_WEIGHTS.map((w) => `roboto-${w}.woff2`)

/** Lists set side by side on A4: both present and short enough to sit in two columns. */
export const PAIR_MAX = { included: 16, excluded: 12 } as const
export function pairLists(q: Pick<QuoteDocumentInput, 'included' | 'excluded'>): boolean {
  return (
    q.excluded.length > 0 &&
    q.included.length <= PAIR_MAX.included &&
    q.excluded.length <= PAIR_MAX.excluded
  )
}

/** The PDF's page footer, "Q3-Q-0001 · page 1 of 2" (used only when there is more than one). */
export function quoteFooterHtml(number: string): string {
  return `<!doctype html><html><head><style>body{margin:0;width:100%;font:8pt Arial,sans-serif;color:#555;text-align:center}</style></head><body><span>${esc(number)} · page <span class="pageNumber"></span> of <span class="totalPages"></span></span></body></html>`
}

export function renderQuoteDocument(q: QuoteDocumentInput): string {
  const fonts = FONT_WEIGHTS.map(
    (w) =>
      `@font-face{font-family:'Roboto';font-style:normal;font-weight:${w};font-display:swap;src:url('${esc(q.fontBase)}roboto-${w}.woff2') format('woff2')}`,
  ).join('')
  const list = (items: string[]) => `<ul>${items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`
  const business = [q.business.legalName, q.business.phone, q.business.email].filter(
    (x): x is string => Boolean(x && x.trim()),
  )
  const title = `Quote ${q.number}${q.version > 1 ? ` (version ${q.version})` : ''}`
  return `<!doctype html><html lang="en-IE"><head><meta charset="utf-8"><title>${esc(title)}</title><style>
${fonts}
@page{size:A4;margin:13mm 16mm 16mm}
*{box-sizing:border-box}
html,body{margin:0;background:#fff;color:#171717;font:400 10pt/1.4 'Roboto',Arial,sans-serif}
.page{max-width:174mm;margin:0 auto;padding:0}
@media screen{.page{padding:24px 16px}}
header{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap;margin-bottom:5mm}
header svg{display:block;width:40mm;height:auto}
.meta{text-align:right;font-size:9.5pt}
.meta h1{margin:0 0 1px;font-size:18pt;font-weight:700;letter-spacing:0.01em}
.meta p{margin:0}
.parties{display:flex;gap:10mm;flex-wrap:wrap;margin-bottom:3mm}
.parties div{flex:1 1 60mm}
.label{font-size:8.5pt;font-weight:500;text-transform:uppercase;letter-spacing:0.08em;color:#555;margin:0 0 1mm}
.parties p{margin:0}
h2{font-size:11pt;font-weight:700;margin:3.5mm 0 1.5mm;border-top:1.5pt solid #000;padding-top:2mm;break-after:avoid}
ul{margin:0;padding-left:5mm}
li{margin:0 0 0.4mm;break-inside:avoid}
.price{margin:5mm 0 2.5mm;border-top:1.5pt solid #000;border-bottom:1.5pt solid #000;padding:2.5mm 0}
.price .big{font-size:22pt;font-weight:700;margin:0}
.price .vat{margin:0;font-weight:500}
p{margin:0 0 2mm}
.small{font-size:9pt}
/* Price, deposit, changes, terms and sign-off stay together: a long quote moves them as one. */
.end{break-inside:avoid}
footer{margin-top:4mm}
.note{white-space:normal}
/* Two short lists side by side on paper; one column on screens (phones, the staff preview). */
@media print{.lists.pair{display:grid;grid-template-columns:1fr 1fr;column-gap:8mm;align-items:start}}
</style></head><body><div class="page">
<header>${WORDMARK_SVG}<div class="meta"><h1>Quote</h1><p>${esc(q.number)}${q.version > 1 ? ` · version ${q.version}` : ''}</p><p>Date: ${esc(longDate(q.sentOn))}</p><p>Good until: ${esc(longDate(q.validUntil))}</p></div></header>
<section class="parties"><div><p class="label">For</p><p>${esc(q.customerName)}</p>${
    q.jobAddress ? `<p>${esc(q.jobAddress)}</p>` : q.jobLine ? `<p>${esc(q.jobLine)}</p>` : ''
  }</div><div><p class="label">From</p>${business.map((b) => `<p>${esc(b)}</p>`).join('')}</div></section>
<div class="lists${pairLists(q) ? ' pair' : ''}"><section><h2>What’s included</h2>${list(q.included)}</section>${
    q.excluded.length ? `<section><h2>What’s not included</h2>${list(q.excluded)}</section>` : ''
  }</div>
${q.note ? `<h2>Note</h2><p class="note">${esc(q.note).replace(/\n/g, '<br>')}</p>` : ''}
<div class="end"><section class="price"><p class="big">${esc(formatEuro(q.price))}</p><p class="vat">VAT included</p></section>
<p>${esc(depositLine(q.depositPercent, q.depositEur))}</p>
<p>${esc(QUOTE_CHANGES_LINE)}</p>
<h2>Terms</h2><p class="small">${esc(q.terms)}</p>
<footer><p>${esc(QUOTE_SIGN_OFF)}${q.business.phone ? `<br>${esc(q.business.phone)}` : ''}</p></footer></div>
</div></body></html>`
}
