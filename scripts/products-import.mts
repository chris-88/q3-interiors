// npm run products:import -- <file.jsonl> --source <slug> --supplier "<Name>" [--dry-run]
//
// Puts a supplier's catalogue into the product list. The file (one JSON object per line: url,
// name, sku, price_inc, categories, ...) is untrusted data: each line is read by
// src/lib/product-import.ts and sent as a JSON parameter to public.import_supplier_products
// (service role only), which upserts by (source, sku), keeps a price staff changed, never
// un-archives and never touches a job's lines. --dry-run writes nothing and reports what would
// happen. The service role key is read from pass for this run only and goes only to the stack's
// own gateway on this machine (http://localhost:8003, or Q3_STACK_URL), never the public URL.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import { addCounts, batches, parseCatalogue, type ImportCounts } from '../src/lib/product-import.ts'

const LOCAL_GATEWAY = 'http://localhost:8003'

function fail(message: string): never {
  console.error(`products:import: ${message}`)
  process.exit(1)
}

function args() {
  const argv = process.argv.slice(2)
  const out = { file: '', source: '', supplier: '', dryRun: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--dry-run') out.dryRun = true
    else if (a === '--source') out.source = argv[++i] ?? ''
    else if (a === '--supplier') out.supplier = argv[++i] ?? ''
    else if (a && !a.startsWith('--') && !out.file) out.file = a
    else fail(`unknown argument ${a}`)
  }
  if (!out.file)
    fail(
      'give the file: npm run products:import -- <file> --source <slug> --supplier "<Name>" [--dry-run]',
    )
  if (!/^[a-z][a-z0-9-]{1,30}$/.test(out.source)) fail('--source must be a slug such as goodwins')
  if (!out.supplier.trim() || out.supplier.length > 80)
    fail('--supplier must be the name shown, such as "Goodwins"')
  return out
}

async function main() {
  const opts = args()
  let text: string
  try {
    text = fs.readFileSync(opts.file, 'utf8')
  } catch {
    fail(`cannot read ${opts.file}`)
  }
  const parsed = parseCatalogue(text)
  console.log(`${parsed.lines} lines read, ${parsed.rows.length} products to send`)
  for (const [reason, n] of Object.entries(parsed.skipped)) console.log(`  skipped ${n}: ${reason}`)

  const base = (process.env.Q3_STACK_URL?.trim() || LOCAL_GATEWAY).replace(/\/+$/, '')
  try {
    await fetch(`${base}/rest/v1/`, { signal: AbortSignal.timeout(5000) })
  } catch {
    fail(
      `the stack's gateway at ${base} is not answering. Is the q3-interiors stack running on this machine?`,
    )
  }
  let key = ''
  try {
    key =
      execFileSync('pass', ['show', 'infra/q3-interiors/SERVICE_ROLE_KEY'], { encoding: 'utf8' })
        .split('\n')[0]
        ?.trim() ?? ''
  } catch {
    fail('could not read infra/q3-interiors/SERVICE_ROLE_KEY from pass')
  }
  if (!key) fail('the service role key in pass is empty')

  let totals: ImportCounts = { added: 0, updated: 0, unchanged: 0, kept_your_price: 0, invalid: 0 }
  const all = batches(parsed.rows, 500)
  for (const [i, rows] of all.entries()) {
    const res = await fetch(`${base}/rest/v1/rpc/import_supplier_products`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        p_source: opts.source,
        p_supplier: opts.supplier.trim(),
        p_rows: rows,
        p_dry_run: opts.dryRun,
      }),
    })
    const body = await res.text()
    if (!res.ok) fail(`batch ${i + 1} of ${all.length}: HTTP ${res.status} ${body.slice(0, 200)}`)
    totals = addCounts(totals, JSON.parse(body) as Partial<ImportCounts>)
  }
  console.log(opts.dryRun ? 'Dry run, nothing written. It would:' : 'Done:')
  console.log(`  add       ${totals.added}`)
  console.log(`  update    ${totals.updated}`)
  console.log(`  unchanged ${totals.unchanged}`)
  console.log(
    `  of those, staff price kept (supplier's price recorded beside it): ${totals.kept_your_price}`,
  )
  console.log(`  refused by the database: ${totals.invalid}`)
}

await main()
