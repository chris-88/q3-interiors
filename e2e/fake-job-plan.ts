// The job plan's functions in the fake staff backend, with the server's rules in short (see
// supabase/migrations/20261201100000_job_plan.sql). Tables live in world.tables: stage_templates,
// job_stages, job_materials, products, tradespeople.
type Row = Record<string, unknown>
type Tables = Record<string, unknown[]>
export type PlanReply = { status: number; body: unknown }

const tidy = (v: unknown) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : '')
const bad = (message: string): PlanReply => ({ status: 400, body: { code: '22023', message } })
const missing = (message: string): PlanReply => ({ status: 404, body: { code: 'P0002', message } })
const ok = (body: unknown = null): PlanReply => ({ status: 200, body })

/** The usual stages a fake world starts with (a few types are enough for the tests). */
export const STAGE_TEMPLATES: Row[] = [
  [
    'bathroom',
    ['Strip out', 'First fix plumbing', 'Tiling', 'Sanitaryware', 'Painting and finish'],
  ],
  [
    'kitchen',
    [
      'Strip out',
      'First fix plumbing and electrics',
      'Units and worktop',
      'Tiling',
      'Painting and finish',
    ],
  ],
  [
    null,
    ['Strip out', 'First fix', 'Plastering', 'Finishes', 'Second fix', 'Painting and snagging'],
  ],
].flatMap(([type, names], t) =>
  (names as string[]).map((name, i) => ({ project_type: type, name, position: t * 100 + i })),
)

export function jobPlanRpc(
  tables: Tables,
  fn: string,
  b: Row,
  actor: { active: boolean; display_name: string },
): PlanReply | null {
  const list = (name: string) => (tables[name] ??= []) as Row[]
  const stages = list('job_stages')
  const lines = list('job_materials')
  const products = list('products')
  const people = list('tradespeople')
  const enquiries = list('enquiries')
  const n = () => `${fn}-${stages.length + lines.length + products.length + people.length + 1}`
  const event = (enquiryId: unknown, kind: string, detail: string) => {
    const e = enquiries.find((x) => x.id === enquiryId)
    if (!e) return
    const events = (e.enquiry_events ?? []) as Row[]
    e.enquiry_events = [
      {
        id: events.length + 900,
        kind,
        detail,
        from_status: null,
        to_status: null,
        reason: null,
        actor_name: actor.display_name,
        created_at: new Date().toISOString(),
      },
      ...events,
    ]
  }
  const sortStages = () => stages.sort((a, b) => Number(a.position) - Number(b.position))
  const stage = () => stages.find((s) => s.id === b.p_stage_id)
  const line = () => lines.find((l) => l.id === b.p_line_id)

  const known = [
    'start_job_plan',
    'add_job_stage',
    'rename_job_stage',
    'move_job_stage',
    'remove_job_stage',
    'set_job_stage_done',
    'set_job_stage_tradesperson',
    'add_tradesperson',
    'update_tradesperson',
    'archive_tradesperson',
    'add_product',
    'update_product',
    'archive_product',
    'add_job_material',
    'update_job_material',
    'set_job_material_got',
    'remove_job_material',
  ]
  if (!known.includes(fn)) return null
  if (!actor.active) return { status: 403, body: { code: '42501', message: 'not allowed' } }

  switch (fn) {
    case 'start_job_plan': {
      const e = enquiries.find((x) => x.id === b.p_enquiry_id)
      if (!e) return missing('enquiry not found')
      if (e.outcome !== 'won') return bad('job not won')
      const have = stages.filter((s) => s.enquiry_id === e.id)
      if (have.length) return ok(have.length)
      const answers = (e.answers ?? {}) as Row
      const templates = list('stage_templates')
      const own = templates.filter((t) => t.project_type === answers.project_type)
      const use = own.length ? own : templates.filter((t) => t.project_type === null)
      use.forEach((t, i) =>
        stages.push({
          id: `stage-${stages.length + 1}`,
          enquiry_id: e.id,
          name: t.name,
          position: i + 1,
          done_at: null,
          tradesperson_id: null,
        }),
      )
      event(e.id, 'plan_started', `${use.length} stages`)
      return ok(use.length)
    }
    case 'add_job_stage': {
      const name = tidy(b.p_name)
      if (!name || name.length > 60) return bad('stage name')
      const mine = stages.filter((s) => s.enquiry_id === b.p_enquiry_id)
      const id = `stage-${stages.length + 1}`
      stages.push({
        id,
        enquiry_id: b.p_enquiry_id,
        name,
        position: Math.max(0, ...mine.map((s) => Number(s.position))) + 1,
        done_at: null,
        tradesperson_id: null,
      })
      return ok(id)
    }
    case 'rename_job_stage': {
      const s = stage()
      if (!s) return missing('stage not found')
      const name = tidy(b.p_name)
      if (!name || name.length > 60) return bad('stage name')
      s.name = name
      return ok()
    }
    case 'move_job_stage': {
      const s = stage()
      if (!s) return missing('stage not found')
      const mine = stages
        .filter((x) => x.enquiry_id === s.enquiry_id)
        .sort((a, c) => Number(a.position) - Number(c.position))
      const other = mine[mine.indexOf(s) + Number(b.p_by)]
      if (other) [s.position, other.position] = [other.position, s.position]
      sortStages()
      return ok()
    }
    case 'remove_job_stage': {
      const s = stage()
      if (!s) return missing('stage not found')
      stages.splice(stages.indexOf(s), 1)
      tables.job_materials = lines.filter((l) => l.stage_id !== s.id)
      return ok()
    }
    case 'set_job_stage_done': {
      const s = stage()
      if (!s) return missing('stage not found')
      if (b.p_done && !s.done_at) {
        s.done_at = new Date().toISOString()
        event(s.enquiry_id, 'stage_done', `${String(s.name)} done`)
      } else if (!b.p_done) s.done_at = null
      return ok()
    }
    case 'set_job_stage_tradesperson': {
      const s = stage()
      if (!s) return missing('stage not found')
      if (b.p_tradesperson_id && !people.some((p) => p.id === b.p_tradesperson_id))
        return missing('tradesperson not found')
      s.tradesperson_id = b.p_tradesperson_id ?? null
      return ok()
    }
    case 'add_tradesperson': {
      const name = tidy(b.p_name)
      if (!name || name.length > 80) return bad('tradesperson')
      const same = people.find((p) => String(p.name).toLowerCase() === name.toLowerCase())
      if (same) {
        same.archived_at = null
        return ok(same.id)
      }
      const id = `person-${people.length + 1}`
      people.push({
        id,
        name,
        trade: tidy(b.p_trade) || null,
        phone: tidy(b.p_phone) || null,
        archived_at: null,
      })
      people.sort((a, c) => String(a.name).localeCompare(String(c.name)))
      return ok(id)
    }
    case 'update_tradesperson': {
      const p = people.find((x) => x.id === b.p_id)
      if (!p) return missing('tradesperson not found')
      const name = tidy(b.p_name)
      if (!name) return bad('tradesperson')
      Object.assign(p, { name, trade: tidy(b.p_trade) || null, phone: tidy(b.p_phone) || null })
      return ok()
    }
    case 'archive_tradesperson': {
      const p = people.find((x) => x.id === b.p_id)
      if (!p) return missing('tradesperson not found')
      p.archived_at = b.p_archived ? (p.archived_at ?? new Date().toISOString()) : null
      return ok()
    }
    case 'add_product': {
      const name = tidy(b.p_name)
      const price = Number(b.p_price_cents)
      if (name.length < 2 || name.length > 80 || !Number.isInteger(price) || price < 0)
        return bad('product')
      const same = products.find((p) => String(p.name).toLowerCase() === name.toLowerCase())
      if (same) {
        same.archived_at = null
        return ok(same.id)
      }
      const id = `product-${n()}`
      products.push({
        id,
        name,
        unit: tidy(b.p_unit) || 'each',
        price_cents: price,
        supplier: tidy(b.p_supplier) || null,
        archived_at: null,
      })
      products.sort((a, c) => String(a.name).localeCompare(String(c.name)))
      return ok(id)
    }
    case 'update_product': {
      const p = products.find((x) => x.id === b.p_id)
      if (!p) return missing('product not found')
      const name = tidy(b.p_name)
      const price = Number(b.p_price_cents)
      if (name.length < 2 || !Number.isInteger(price) || price < 0) return bad('product')
      Object.assign(p, {
        name,
        unit: tidy(b.p_unit) || 'each',
        price_cents: price,
        supplier: tidy(b.p_supplier) || null,
      })
      return ok()
    }
    case 'archive_product': {
      const p = products.find((x) => x.id === b.p_id)
      if (!p) return missing('product not found')
      p.archived_at = b.p_archived ? (p.archived_at ?? new Date().toISOString()) : null
      return ok()
    }
    case 'add_job_material': {
      const s = stage()
      if (!s) return missing('stage not found')
      const p = products.find((x) => x.id === b.p_product_id)
      if (!p) return missing('product not found')
      const qty = b.p_quantity == null ? 1 : Number(b.p_quantity)
      if (!(qty > 0)) return bad('line')
      const id = `line-${lines.length + 1}-${n()}`
      // The snapshot: the line keeps the product's name, unit and price as they are now.
      lines.push({
        id,
        enquiry_id: s.enquiry_id,
        stage_id: s.id,
        product_id: p.id,
        name: p.name,
        quantity: qty,
        unit: tidy(b.p_unit) || p.unit,
        price_cents: b.p_price_cents == null ? p.price_cents : Number(b.p_price_cents),
        got_at: null,
        position: lines.length + 1,
      })
      return ok(id)
    }
    case 'update_job_material': {
      const l = line()
      if (!l) return missing('line not found')
      const qty = Number(b.p_quantity)
      if (!(qty > 0) || !tidy(b.p_unit) || !Number.isInteger(Number(b.p_price_cents)))
        return bad('line')
      Object.assign(l, {
        quantity: qty,
        unit: tidy(b.p_unit),
        price_cents: Number(b.p_price_cents),
      })
      return ok()
    }
    case 'set_job_material_got': {
      const l = line()
      if (!l) return missing('line not found')
      l.got_at = b.p_got ? (l.got_at ?? new Date().toISOString()) : null
      return ok()
    }
    case 'remove_job_material': {
      const l = line()
      if (!l) return missing('line not found')
      lines.splice(lines.indexOf(l), 1)
      return ok()
    }
  }
  return null
}
