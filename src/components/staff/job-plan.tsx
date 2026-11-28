// The job plan (2026-11-28, slice 1): Dad's notebook as a checklist. Stages in order, each with the
// materials it needs (from his own product list, which grows as he types), a tick for each item
// got, the stage's tradesperson, and totals. At 390px each stage is a section of rows; from 1024px
// the same plan is one table (stage, item, qty, unit, price each, total, got it, tradesperson).
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import {
  useAddLine,
  useProductSearch,
  useAddProduct,
  useAddStage,
  useAddTradesperson,
  useLineGot,
  useMoveStage,
  useRemoveLine,
  useRemoveStage,
  useRenameStage,
  useStageDone,
  useStageTradesperson,
  useUpdateLine,
  type JobPlan,
} from '@/api/job-plan'
import { Confirm } from '@/components/staff/confirm'
import { Button, buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import {
  exactProduct,
  formatCents,
  lineTotal,
  parseEuroToCents,
  parseQuantity,
  planByStage,
  priceText,
  quantityText,
  productPriceLine,
  totalsOf,
  toGetLine,
  nextStageLine,
  UNITS,
  type PlanLine,
  type PlanStage,
  type Tradesperson,
} from '@/lib/job-plan'

/** True from 1024px: the plan is then one table. */
export function useWide(query = '(min-width: 1024px)') {
  const get = () => typeof window !== 'undefined' && window.matchMedia?.(query).matches === true
  const [wide, setWide] = useState(get)
  useEffect(() => {
    const m = window.matchMedia?.(query)
    if (!m) return
    const on = () => setWide(m.matches)
    m.addEventListener('change', on)
    return () => m.removeEventListener('change', on)
  }, [query])
  return wide
}

const errorText = 'Not saved. Try again.'

/** The unit as chips, so "m2" and "sqm" do not split; anything else is typed under Other. */
export function UnitChips({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const id = useId()
  const known = (UNITS as readonly string[]).includes(value)
  const [other, setOther] = useState(!known)
  const chip =
    'border-edge has-checked:border-action has-checked:bg-action flex min-h-12 min-w-12 cursor-pointer items-center justify-center rounded-full border px-3 text-base has-checked:text-white has-focus-visible:outline-3 has-focus-visible:outline-offset-3'
  return (
    <fieldset className="flex min-w-0 flex-col gap-1">
      <legend className="mb-1 text-sm">Unit</legend>
      <div className="flex flex-wrap gap-2">
        {UNITS.map((u) => (
          <label key={u} className={chip}>
            <input
              type="radio"
              name={`${id}-unit`}
              className="sr-only"
              checked={!other && value === u}
              onChange={() => {
                setOther(false)
                onChange(u)
              }}
            />
            {u}
          </label>
        ))}
        <label className={chip}>
          <input
            type="radio"
            name={`${id}-unit`}
            className="sr-only"
            checked={other}
            onChange={() => {
              setOther(true)
              if (known) onChange('')
            }}
          />
          Other
        </label>
      </div>
      {other && (
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-other`} className="text-sm">
            Other unit
          </label>
          <Input
            id={`${id}-other`}
            className="h-12 text-base"
            maxLength={20}
            value={value}
            onChange={(e) => onChange(e.target.value)}
          />
        </div>
      )}
    </fieldset>
  )
}

function Err({ show, text = errorText }: { show: boolean; text?: string }) {
  if (!show) return null
  return (
    <p role="alert" className="text-destructive text-sm">
      {text}
    </p>
  )
}

/** The usual way to show a line: "12.5 m2 × €24.50". */
const lineSum = (l: PlanLine) =>
  `${quantityText(l.quantity)} ${l.unit} × ${formatCents(l.price_cents)}`

// ---------------------------------------------------------------------------------------------
// One line
// ---------------------------------------------------------------------------------------------

function GotIt({ enquiryId, line }: { enquiryId: string; line: PlanLine }) {
  const got = useLineGot(enquiryId)
  // Shown at once; the saved value takes over once the plan is read again.
  const [want, setWant] = useState<boolean | null>(null)
  const checked = want ?? !!line.got_at
  return (
    <label className="flex min-h-12 min-w-12 cursor-pointer items-center justify-center gap-2 text-sm">
      <input
        type="checkbox"
        className="size-5"
        checked={checked}
        aria-label={`Got it: ${line.name}`}
        onChange={(e) => {
          setWant(e.target.checked)
          got.mutate({ lineId: line.id, got: e.target.checked }, { onSettled: () => setWant(null) })
        }}
      />
      <span aria-hidden="true" className="lg:sr-only">
        Got it
      </span>
      {got.isError && (
        <span role="alert" className="text-destructive text-xs">
          Not saved
        </span>
      )}
    </label>
  )
}

function LineEditor({
  enquiryId,
  line,
  onDone,
  focus = true,
}: {
  enquiryId: string
  line: PlanLine
  onDone: () => void
  /** Move focus to Quantity (not when he has gone on typing the next item). */
  focus?: boolean
}) {
  const id = useId()
  const update = useUpdateLine(enquiryId)
  const remove = useRemoveLine(enquiryId)
  const [qty, setQty] = useState(quantityText(line.quantity))
  const [unit, setUnit] = useState(line.unit)
  const [price, setPrice] = useState(priceText(line.price_cents))
  const [problem, setProblem] = useState<string | null>(null)
  const [removing, setRemoving] = useState(false)
  useEffect(() => {
    if (!focus) return
    const el = document.getElementById(`${id}-qty`) as HTMLInputElement | null
    el?.focus()
    el?.select()
  }, [id, focus])
  const save = () => {
    const q = parseQuantity(qty)
    const c = parseEuroToCents(price)
    if (q === null) return setProblem('Enter a quantity, for example 2 or 12.5.')
    if (!unit.trim()) return setProblem('Enter a unit, for example each, m2 or bag.')
    if (c === null) return setProblem('Enter the price each in euro, for example 24.50.')
    setProblem(null)
    update.mutate(
      { lineId: line.id, quantity: q, unit: unit.trim(), priceCents: c },
      { onSuccess: onDone },
    )
  }
  if (removing)
    return (
      <Confirm
        question={`Remove ${line.name} from this stage?`}
        detail="It stays in your product list."
        confirm="Remove it"
        danger
        pending={remove.isPending}
        pendingLabel="Removing…"
        error={remove.isError ? errorText : null}
        onConfirm={() => remove.mutate(line.id, { onSuccess: onDone })}
        onCancel={() => setRemoving(false)}
      />
    )
  return (
    <form
      noValidate
      className="flex flex-col gap-3 rounded-md border p-3"
      onSubmit={(e) => {
        e.preventDefault()
        save()
      }}
    >
      <p className="font-medium">{line.name}</p>
      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-qty`} className="text-sm">
            Quantity
          </label>
          <Input
            id={`${id}-qty`}
            inputMode="decimal"
            enterKeyHint="done"
            className="h-12 text-base"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-price`} className="text-sm">
            Price each (€)
          </label>
          <Input
            id={`${id}-price`}
            inputMode="decimal"
            className="h-12 text-base"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
          />
        </div>
      </div>
      <UnitChips value={unit} onChange={setUnit} />
      <p className="text-muted-foreground text-xs">
        Changes this job only; the usual price in your product list stays as it is.
      </p>
      {problem && (
        <p role="alert" className="text-destructive text-sm">
          {problem}
        </p>
      )}
      <Err show={update.isError} />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="outline" className="h-12 px-5" disabled={update.isPending}>
          {update.isPending ? 'Saving…' : 'Save'}
        </Button>
        <Button type="button" variant="ghost" className="h-12" onClick={onDone}>
          Cancel
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="text-destructive h-12"
          onClick={() => setRemoving(true)}
        >
          Remove
        </Button>
      </div>
    </form>
  )
}

// ---------------------------------------------------------------------------------------------
// Adding an item: search the product list as he types, or add a new one
// ---------------------------------------------------------------------------------------------

function NewProduct({
  enquiryId,
  stageId,
  name,
  onDone,
}: {
  enquiryId: string
  stageId: string
  name: string
  onDone: () => void
}) {
  const id = useId()
  const addProduct = useAddProduct(enquiryId)
  const addLine = useAddLine(enquiryId)
  const [qty, setQty] = useState('1')
  const [unit, setUnit] = useState('each')
  const [price, setPrice] = useState('')
  const [supplier, setSupplier] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  useEffect(() => document.getElementById(`${id}-qty`)?.focus(), [id])
  const busy = addProduct.isPending || addLine.isPending
  const save = () => {
    const c = parseEuroToCents(price)
    const q = parseQuantity(qty)
    if (q === null) return setProblem('Enter a quantity, for example 2 or 12.5.')
    if (c === null) return setProblem('Enter the usual price each in euro, for example 24.50.')
    if (!unit.trim()) return setProblem('Enter a unit, for example each, m2 or bag.')
    setProblem(null)
    addProduct.mutate(
      { name, unit: unit.trim(), priceCents: c, supplier: supplier.trim() },
      {
        onSuccess: (productId) =>
          addLine.mutate({ stageId, productId, quantity: q }, { onSuccess: () => onDone() }),
      },
    )
  }
  return (
    <form
      noValidate
      className="flex flex-col gap-3 rounded-md border p-3"
      onSubmit={(e) => {
        e.preventDefault()
        save()
      }}
    >
      <p className="font-medium">New product: {name}</p>
      <p className="text-muted-foreground text-sm">
        It is saved to your product list, so next time you can just search for it.
      </p>
      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-qty`} className="text-sm">
            Quantity
          </label>
          <Input
            id={`${id}-qty`}
            inputMode="decimal"
            className="h-12 text-base"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-price`} className="text-sm">
            Price each (€)
          </label>
          <Input
            id={`${id}-price`}
            inputMode="decimal"
            className="h-12 text-base"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
          />
        </div>
      </div>
      <UnitChips value={unit} onChange={setUnit} />
      <div className="flex flex-col gap-1">
        <label htmlFor={`${id}-supplier`} className="text-sm">
          Supplier (optional)
        </label>
        <Input
          id={`${id}-supplier`}
          className="h-12 text-base"
          value={supplier}
          onChange={(e) => setSupplier(e.target.value)}
        />
      </div>
      {problem && (
        <p role="alert" className="text-destructive text-sm">
          {problem}
        </p>
      )}
      <Err show={addProduct.isError || addLine.isError} />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="outline" className="h-12 px-5" disabled={busy}>
          {busy ? 'Saving…' : 'Save and add'}
        </Button>
        <Button type="button" variant="ghost" className="h-12" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  )
}

/** The value after it has stopped changing for a moment (so the server is asked once per pause). */
function useSettled<T>(value: T, ms = 200): T {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    const t = window.setTimeout(() => setSettled(value), ms)
    return () => window.clearTimeout(t)
  }, [value, ms])
  return settled
}

function AddItem({
  enquiryId,
  stage,
  onAdded,
}: {
  enquiryId: string
  stage: PlanStage
  /** The new line, and whether its Quantity should take focus (not if he typed on). */
  onAdded: (lineId: string, focus: boolean) => void
}) {
  const id = useId()
  const add = useAddLine(enquiryId)
  const [query, setQuery] = useState('')
  // What is in the box right now, read when a save returns (state there would be stale).
  const current = useRef('')
  const type = (v: string) => {
    current.current = v
    setQuery(v)
  }
  const [creating, setCreating] = useState<string | null>(null)
  const typed = query.trim().replace(/\s+/g, ' ')
  const asked = useSettled(typed)
  const search = useProductSearch(asked)
  // Results for what is on screen now (an older answer is kept while the next one loads).
  const matches = typed.length >= 2 ? (search.data ?? []) : []
  const exact = exactProduct(matches, typed)
  const settled = asked === typed && !search.isFetching
  const focusInput = () => document.getElementById(`${id}-q`)?.focus()
  if (creating)
    return (
      <NewProduct
        enquiryId={enquiryId}
        stageId={stage.id}
        name={creating}
        onDone={() => {
          setCreating(null)
          window.requestAnimationFrame(focusInput)
        }}
      />
    )
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={`${id}-q`} className="sr-only">
        Add item to {stage.name}
      </label>
      <Input
        id={`${id}-q`}
        autoComplete="off"
        placeholder="Add item"
        className="h-12 text-base"
        value={query}
        aria-describedby={`${id}-hint`}
        onChange={(e) => type(e.target.value)}
      />
      <p id={`${id}-hint`} className="sr-only">
        Type to search your product list and the supplier catalogue; matches appear below.
      </p>
      {typed.length >= 2 && (
        <ul aria-label={`Matches for ${typed}`} className="flex flex-col gap-1">
          {matches.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                className="border-edge hover:bg-soft flex min-h-12 w-full items-center justify-between gap-3 rounded-md border px-3 py-2 text-left"
                onClick={() => {
                  // The box is cleared as the item goes in, so anything typed next is kept; the
                  // new line then asks the quantity, unless he has already typed the next item.
                  type('')
                  focusInput()
                  add.mutate(
                    { stageId: stage.id, productId: p.id },
                    { onSuccess: (lineId) => onAdded(lineId, current.current === '') },
                  )
                }}
              >
                <span className="flex min-w-0 flex-col">
                  <span className="font-medium break-words">{p.name}</span>
                  {p.category && (
                    <span className="text-muted-foreground text-xs break-words">{p.category}</span>
                  )}
                </span>
                <span className="text-muted-foreground shrink-0 text-right text-sm">
                  {productPriceLine(p)}
                  {(p.uses ?? 0) > 0 && <span className="block text-xs">Used before</span>}
                </span>
              </button>
            </li>
          ))}
          {search.isError && (
            <li role="alert" className="text-destructive text-sm">
              Could not search the list. Try again.
            </li>
          )}
          {!exact && settled && (
            <li>
              <button
                type="button"
                className="border-edge hover:bg-soft flex min-h-12 w-full items-center rounded-md border border-dashed px-3 py-2 text-left"
                onClick={() => {
                  setCreating(typed)
                  type('')
                }}
              >
                Add “{typed}” as new
              </button>
            </li>
          )}
        </ul>
      )}
      <Err show={add.isError} />
    </div>
  )
}

// ---------------------------------------------------------------------------------------------
// A stage's own controls: done, tradesperson, rename / move / remove
// ---------------------------------------------------------------------------------------------

function StageDone({ enquiryId, stage }: { enquiryId: string; stage: PlanStage }) {
  const done = useStageDone(enquiryId)
  const [want, setWant] = useState<boolean | null>(null)
  const checked = want ?? !!stage.done_at
  return (
    <label className="flex min-h-12 cursor-pointer items-center gap-2 text-sm">
      <input
        type="checkbox"
        className="size-5"
        checked={checked}
        onChange={(e) => {
          setWant(e.target.checked)
          done.mutate(
            { stageId: stage.id, done: e.target.checked },
            { onSettled: () => setWant(null) },
          )
        }}
      />
      Done
      <span className="sr-only">: {stage.name}</span>
      {done.isError && (
        <span role="alert" className="text-destructive text-xs">
          Not saved
        </span>
      )}
    </label>
  )
}

const NEW = '__new__'

function TradespersonPicker({
  enquiryId,
  stage,
  people,
}: {
  enquiryId: string
  stage: PlanStage
  people: Tradesperson[]
}) {
  const id = useId()
  const set = useStageTradesperson(enquiryId)
  const add = useAddTradesperson(enquiryId)
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [trade, setTrade] = useState('')
  const [phone, setPhone] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const shown = people.filter((p) => !p.archived_at || p.id === stage.tradesperson_id)
  const label = (p: Tradesperson) => (p.trade ? `${p.name} (${p.trade})` : p.name)
  useEffect(() => {
    if (adding) document.getElementById(`${id}-name`)?.focus()
  }, [adding, id])
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={`${id}-who`} className="text-muted-foreground text-sm lg:sr-only">
        Tradesperson<span className="sr-only"> for {stage.name}</span>
      </label>
      <NativeSelect
        id={`${id}-who`}
        className="w-full [&_select]:h-12 [&_select]:text-base"
        value={adding ? NEW : (stage.tradesperson_id ?? '')}
        disabled={set.isPending}
        onChange={(e) => {
          if (e.target.value === NEW) return setAdding(true)
          setAdding(false)
          set.mutate({ stageId: stage.id, tradespersonId: e.target.value || null })
        }}
      >
        <NativeSelectOption value="">No one yet</NativeSelectOption>
        {shown.map((p) => (
          <NativeSelectOption key={p.id} value={p.id}>
            {label(p)}
          </NativeSelectOption>
        ))}
        <NativeSelectOption value={NEW}>Add someone new…</NativeSelectOption>
      </NativeSelect>
      {adding && (
        <form
          noValidate
          className="flex flex-col gap-2 rounded-md border p-3"
          onSubmit={(e) => {
            e.preventDefault()
            if (!name.trim()) return setProblem('Enter their name.')
            setProblem(null)
            add.mutate(
              { name: name.trim(), trade: trade.trim(), phone: phone.trim() },
              {
                onSuccess: (personId) =>
                  set.mutate(
                    { stageId: stage.id, tradespersonId: personId },
                    {
                      onSuccess: () => {
                        setAdding(false)
                        setName('')
                        setTrade('')
                        setPhone('')
                      },
                    },
                  ),
              },
            )
          }}
        >
          {(
            [
              ['name', 'Name', name, setName],
              ['trade', 'Trade (optional)', trade, setTrade],
              ['phone', 'Phone (optional)', phone, setPhone],
            ] as const
          ).map(([key, text, value, change]) => (
            <div key={key} className="flex flex-col gap-1">
              <label htmlFor={`${id}-${key}`} className="text-sm">
                {text}
              </label>
              <Input
                id={`${id}-${key}`}
                inputMode={key === 'phone' ? 'tel' : undefined}
                className="h-12 text-base"
                value={value}
                onChange={(e) => change(e.target.value)}
              />
            </div>
          ))}
          {problem && (
            <p role="alert" className="text-destructive text-sm">
              {problem}
            </p>
          )}
          <Err show={add.isError || set.isError} />
          <div className="flex flex-wrap gap-2">
            <Button
              type="submit"
              variant="outline"
              className="h-12 px-5"
              disabled={add.isPending || set.isPending}
            >
              {add.isPending || set.isPending ? 'Saving…' : 'Save and assign'}
            </Button>
            <Button type="button" variant="ghost" className="h-12" onClick={() => setAdding(false)}>
              Cancel
            </Button>
          </div>
        </form>
      )}
      <Err show={set.isError && !adding} />
    </div>
  )
}

function StageOptions({
  enquiryId,
  stage,
  first,
  last,
  extra = null,
}: {
  enquiryId: string
  stage: PlanStage
  first: boolean
  last: boolean
  /** An empty stage keeps its tradesperson in here, so the stage is one line and Add item. */
  extra?: ReactNode
}) {
  const id = useId()
  const rename = useRenameStage(enquiryId)
  const move = useMoveStage(enquiryId)
  const remove = useRemoveStage(enquiryId)
  const [name, setName] = useState(stage.name)
  const [removing, setRemoving] = useState(false)
  return (
    <details className="group">
      <summary className="text-muted-foreground flex min-h-12 cursor-pointer list-none items-center text-sm underline underline-offset-4 [&::-webkit-details-marker]:hidden">
        Change stage<span className="sr-only">: {stage.name}</span>
      </summary>
      <div className="flex flex-col gap-3 pt-2">
        {extra}
        <form
          noValidate
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (name.trim()) rename.mutate({ stageId: stage.id, name: name.trim() })
          }}
        >
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <label htmlFor={`${id}-name`} className="text-sm">
              Stage name
            </label>
            <Input
              id={`${id}-name`}
              className="h-12 text-base"
              value={name}
              maxLength={60}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <Button type="submit" variant="outline" className="h-12" disabled={rename.isPending}>
            Rename
          </Button>
        </form>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            className="h-12"
            disabled={first || move.isPending}
            onClick={() => move.mutate({ stageId: stage.id, by: -1 })}
          >
            Move up
          </Button>
          <Button
            variant="outline"
            className="h-12"
            disabled={last || move.isPending}
            onClick={() => move.mutate({ stageId: stage.id, by: 1 })}
          >
            Move down
          </Button>
          <Button
            variant="ghost"
            className="text-destructive h-12"
            onClick={() => setRemoving(true)}
          >
            Remove stage
          </Button>
        </div>
        {removing && (
          <Confirm
            question={`Remove ${stage.name} and its items?`}
            detail="The items stay in your product list."
            confirm="Remove the stage"
            danger
            pending={remove.isPending}
            pendingLabel="Removing…"
            error={remove.isError ? errorText : null}
            onConfirm={() => remove.mutate(stage.id)}
            onCancel={() => setRemoving(false)}
          />
        )}
        <Err show={rename.isError || move.isError} />
      </div>
    </details>
  )
}

// ---------------------------------------------------------------------------------------------
// The two layouts
// ---------------------------------------------------------------------------------------------

type Props = {
  enquiryId: string
  plan: JobPlan
  people: Tradesperson[]
}

type ViewProps = Props & {
  /** Only what is still to get: got items and stages with nothing left are hidden. */
  onlyToGet: boolean
  opened: Opened
  setOpened: (o: Opened) => void
}

/** The stages and lines to show: everything, or only what is left to get. */
function shownStages(plan: JobPlan, onlyToGet: boolean) {
  const stages = planByStage(plan.stages, plan.lines)
  if (!onlyToGet) return stages
  return stages
    .map((s) => ({ ...s, lines: s.lines.filter((l) => !l.got_at) }))
    .filter((s) => s.lines.length > 0)
}

type Opened = { lineId: string; focus: boolean } | null

function LineRow({
  enquiryId,
  line,
  opened,
  onClosed,
}: {
  enquiryId: string
  line: PlanLine
  opened: Opened
  onClosed: () => void
}) {
  const justAdded = opened?.lineId === line.id
  const [chosen, setEditing] = useState(false)
  // A line just added opens at once; one tapped opens too.
  const editing = chosen || justAdded
  const close = () => {
    setEditing(false)
    if (justAdded) onClosed()
  }
  if (editing)
    return (
      <li>
        <LineEditor
          enquiryId={enquiryId}
          line={line}
          onDone={close}
          focus={!justAdded || (opened?.focus ?? true)}
        />
      </li>
    )
  return (
    <li className="flex items-center gap-2 border-t py-1">
      <GotIt enquiryId={enquiryId} line={line} />
      <button
        type="button"
        className="hover:bg-soft flex min-h-12 min-w-0 flex-1 flex-col items-start justify-center rounded-md px-1 text-left"
        onClick={() => setEditing(true)}
      >
        <span className={`font-medium break-words ${line.got_at ? 'text-muted-foreground' : ''}`}>
          {line.name}
          <span className="sr-only">: change</span>
        </span>
        <span className="text-muted-foreground text-sm">{lineSum(line)}</span>
      </button>
      <span className="shrink-0 text-right tabular-nums">{formatCents(lineTotal(line))}</span>
    </li>
  )
}

function StageSections({ enquiryId, plan, people, onlyToGet, opened, setOpened }: ViewProps) {
  const stages = shownStages(plan, onlyToGet)
  const all = planByStage(plan.stages, plan.lines)
  return (
    <div className="flex flex-col gap-4">
      {stages.map(({ stage, lines, totals }) => (
        <section
          key={stage.id}
          aria-labelledby={`stage-${stage.id}`}
          className={`bg-background flex flex-col rounded-md border p-3 ${totals.items === 0 ? 'gap-1' : 'gap-2'}`}
        >
          <div className="flex items-start justify-between gap-2">
            <h2 id={`stage-${stage.id}`} className="text-lg leading-snug font-medium break-words">
              {stage.name}
            </h2>
            <StageDone enquiryId={enquiryId} stage={stage} />
          </div>
          {totals.items > 0 && (
            <p className="text-muted-foreground text-sm">
              {`${totals.items} ${totals.items === 1 ? 'item' : 'items'} · ${totals.got} got · ${formatCents(totals.cents)}`}
            </p>
          )}
          {totals.items > 0 && (
            <TradespersonPicker enquiryId={enquiryId} stage={stage} people={people} />
          )}
          {lines.length > 0 && (
            <ul aria-label={`Items for ${stage.name}`} className="flex flex-col">
              {lines.map((l) => (
                <LineRow
                  key={l.id}
                  enquiryId={enquiryId}
                  line={l}
                  opened={opened}
                  onClosed={() => setOpened(null)}
                />
              ))}
            </ul>
          )}
          <AddItem
            enquiryId={enquiryId}
            stage={stage}
            onAdded={(lineId, focus) => setOpened({ lineId, focus })}
          />
          <StageOptions
            enquiryId={enquiryId}
            stage={stage}
            first={all[0]?.stage.id === stage.id}
            last={all[all.length - 1]?.stage.id === stage.id}
            extra={
              totals.items === 0 ? (
                <TradespersonPicker enquiryId={enquiryId} stage={stage} people={people} />
              ) : null
            }
          />
        </section>
      ))}
    </div>
  )
}

function TableLine({
  enquiryId,
  line,
  opened,
  onClosed,
}: {
  enquiryId: string
  line: PlanLine
  opened: Opened
  onClosed: () => void
}) {
  const justAdded = opened?.lineId === line.id
  const [chosen, setEditing] = useState(false)
  // A line just added opens at once; one tapped opens too.
  const editing = chosen || justAdded
  const close = () => {
    setEditing(false)
    if (justAdded) onClosed()
  }
  if (editing)
    return (
      <td colSpan={6} className="p-2">
        <LineEditor
          enquiryId={enquiryId}
          line={line}
          onDone={close}
          focus={!justAdded || (opened?.focus ?? true)}
        />
      </td>
    )
  return (
    <>
      <td className="p-2">
        <button
          type="button"
          className="hover:bg-soft min-h-12 rounded-md px-1 text-left font-medium underline-offset-4 hover:underline"
          onClick={() => setEditing(true)}
        >
          {line.name}
          <span className="sr-only">: change</span>
        </button>
      </td>
      <td className="p-2 text-right tabular-nums">{quantityText(line.quantity)}</td>
      <td className="p-2">{line.unit}</td>
      <td className="p-2 text-right tabular-nums">{formatCents(line.price_cents)}</td>
      <td className="p-2 text-right tabular-nums">{formatCents(lineTotal(line))}</td>
      <td className="p-2">
        <GotIt enquiryId={enquiryId} line={line} />
      </td>
    </>
  )
}

function PlanTable({ enquiryId, plan, people, onlyToGet, opened, setOpened }: ViewProps) {
  const stages = shownStages(plan, onlyToGet)
  const order = planByStage(plan.stages, plan.lines)
  const all = totalsOf(plan.lines)
  return (
    <table className="bg-background w-full border-collapse rounded-md border text-sm">
      <caption className="sr-only">The job plan: stages, items and who does each stage</caption>
      <thead>
        <tr className="text-muted-foreground border-b text-left">
          <th scope="col" className="w-56 p-2 font-medium">
            Stage
          </th>
          <th scope="col" className="p-2 font-medium">
            Item
          </th>
          <th scope="col" className="p-2 text-right font-medium">
            Qty
          </th>
          <th scope="col" className="p-2 font-medium">
            Unit
          </th>
          <th scope="col" className="p-2 text-right font-medium">
            Price each
          </th>
          <th scope="col" className="p-2 text-right font-medium">
            Total
          </th>
          <th scope="col" className="p-2 font-medium">
            Got it
          </th>
          <th scope="col" className="w-56 p-2 font-medium">
            Tradesperson
          </th>
        </tr>
      </thead>
      {stages.map(({ stage, lines, totals }) => {
        const span = lines.length + 1
        const stageCell = (
          <th
            scope="rowgroup"
            rowSpan={span}
            className="border-r p-2 text-left align-top font-normal"
          >
            <span id={`stage-${stage.id}`} className="block text-base font-medium">
              {stage.name}
            </span>
            <span className="text-muted-foreground block">
              {totals.items === 0
                ? 'No items yet'
                : `${totals.items} ${totals.items === 1 ? 'item' : 'items'} · ${formatCents(totals.cents)}`}
            </span>
            <StageDone enquiryId={enquiryId} stage={stage} />
            <StageOptions
              enquiryId={enquiryId}
              stage={stage}
              first={order[0]?.stage.id === stage.id}
              last={order[order.length - 1]?.stage.id === stage.id}
            />
          </th>
        )
        const whoCell = (
          <td rowSpan={span} className="border-l p-2 align-top">
            <TradespersonPicker enquiryId={enquiryId} stage={stage} people={people} />
          </td>
        )
        const add = (
          <td colSpan={6} className="p-2">
            <AddItem
              enquiryId={enquiryId}
              stage={stage}
              onAdded={(lineId, focus) => setOpened({ lineId, focus })}
            />
          </td>
        )
        return (
          <tbody key={stage.id} className="border-t-2">
            {lines.length === 0 ? (
              <tr>
                {stageCell}
                {add}
                {whoCell}
              </tr>
            ) : (
              <>
                {lines.map((l, n) => (
                  <tr key={l.id} className="border-t align-middle">
                    {n === 0 && stageCell}
                    <TableLine
                      enquiryId={enquiryId}
                      line={l}
                      opened={opened}
                      onClosed={() => setOpened(null)}
                    />
                    {n === 0 && whoCell}
                  </tr>
                ))}
                <tr>{add}</tr>
              </>
            )}
          </tbody>
        )
      })}
      <tfoot>
        <tr className="border-t-2 font-medium">
          <th scope="row" colSpan={5} className="p-2 text-left">
            Job total ({all.items} {all.items === 1 ? 'item' : 'items'}, {all.got} got)
          </th>
          <td className="p-2 text-right tabular-nums">{formatCents(all.cents)}</td>
          <td colSpan={2}>
            <span className="sr-only">No total</span>
          </td>
        </tr>
      </tfoot>
    </table>
  )
}

function AddStage({ enquiryId }: { enquiryId: string }) {
  const add = useAddStage(enquiryId)
  const [name, setName] = useState('')
  return (
    <form
      noValidate
      className="flex items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        if (name.trim()) add.mutate(name.trim(), { onSuccess: () => setName('') })
      }}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <label htmlFor="plan-new-stage" className="text-sm font-medium">
          Add a stage
        </label>
        <Input
          id="plan-new-stage"
          className="h-12 text-base"
          maxLength={60}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <Button type="submit" variant="outline" className="h-12 px-5" disabled={add.isPending}>
        Add
      </Button>
      <Err show={add.isError} />
    </form>
  )
}

/** The started plan: the job's totals, the stages (sections or the table), adding a stage. */
export function PlanView(props: Props) {
  const wide = useWide()
  const [onlyToGet, setOnlyToGet] = useState(false)
  const [opened, setOpened] = useState<Opened>(null)
  const all = totalsOf(props.plan.lines)
  const done = props.plan.stages.filter((s) => s.done_at).length
  const left = all.items - all.got
  const view = { ...props, onlyToGet, opened, setOpened }
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center justify-between gap-x-4">
          <p className="text-lg font-medium">{toGetLine(props.plan.lines)}</p>
          {left > 0 && (
            <label className="flex min-h-12 cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-5"
                checked={onlyToGet}
                onChange={(e) => setOnlyToGet(e.target.checked)}
              />
              Show only these
            </label>
          )}
        </div>
        <p>{nextStageLine(props.plan.stages, props.people)}</p>
        <p className="text-muted-foreground text-sm">
          {formatCents(all.cents)} in all · {all.items} {all.items === 1 ? 'item' : 'items'},{' '}
          {all.got} got · {done} of {props.plan.stages.length} stages done
        </p>
      </div>
      {onlyToGet && left === 0 ? (
        <p className="text-muted-foreground">Everything is got.</p>
      ) : wide ? (
        <PlanTable {...view} />
      ) : (
        <StageSections {...view} />
      )}
      <AddStage enquiryId={props.enquiryId} />
      <PlanLists />
    </div>
  )
}

/** The lists behind the plan, a tap away. */
export function PlanLists({ children }: { children?: ReactNode }) {
  return (
    <p className="text-muted-foreground flex flex-wrap gap-x-4 text-sm">
      <Link className="inline-flex min-h-12 items-center underline" to="/settings/products">
        Your product list
      </Link>
      <Link className="inline-flex min-h-12 items-center underline" to="/settings/tradespeople">
        Tradespeople
      </Link>
      {children}
    </p>
  )
}

/** The plan in one line for the enquiry page's fold, and the way in. */
export function PlanFoldBody({
  enquiryId,
  plan,
  people,
}: {
  enquiryId: string
  plan: JobPlan | undefined
  people: Tradesperson[]
}) {
  const link = (text: string) => (
    <Link
      to={`/enquiries/${enquiryId}/plan`}
      className={buttonVariants({ variant: 'outline', className: 'h-12 self-start px-5' })}
    >
      {text}
    </Link>
  )
  if (!plan) return <p className="text-muted-foreground text-sm">Loading the plan…</p>
  if (plan.stages.length === 0)
    return (
      <div className="flex flex-col gap-2">
        <p className="text-sm">No plan yet. Start from the usual stages for this kind of job.</p>
        {link('Start the plan')}
      </div>
    )
  const stages = planByStage(plan.stages, plan.lines)
  return (
    <div className="flex flex-col gap-2">
      <p className="font-medium">{toGetLine(plan.lines)}</p>
      <p className="text-sm">{nextStageLine(plan.stages, people)}</p>
      <ul className="flex flex-col text-sm">
        {stages.map(({ stage, totals }) => {
          const who = people.find((p) => p.id === stage.tradesperson_id)
          return (
            <li key={stage.id} className="flex justify-between gap-3 border-t py-2">
              <span className="min-w-0 break-words">
                {stage.done_at ? '✓ ' : ''}
                {stage.name}
                {who ? <span className="text-muted-foreground"> · {who.name}</span> : null}
              </span>
              <span className="text-muted-foreground shrink-0 tabular-nums">
                {totals.items ? formatCents(totals.cents) : '–'}
              </span>
            </li>
          )
        })}
      </ul>
      {link('Open the plan')}
    </div>
  )
}
