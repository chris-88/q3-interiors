// The lists behind job plans (Settings, any staff member): the product list (name, unit, usual
// price each, supplier) and the tradespeople (name, trade, phone). Search, change, archive. A
// changed usual price applies to items added from now on; jobs already planned keep theirs.
import { useEffect, useId, useState, type ReactNode } from 'react'
import {
  useAddProduct,
  useAddTradesperson,
  useArchiveProduct,
  useArchiveTradesperson,
  useProductBrowse,
  type ProductFilter,
  useTradespeople,
  useUpdateProduct,
  useUpdateTradesperson,
} from '@/api/job-plan'
import { BackToSettings } from '@/components/staff/settings-ui'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import {
  parseEuroToCents,
  productPriceLine,
  sourceName,
  SOURCE_NAMES,
  priceText,
  type Product,
  type Tradesperson,
} from '@/lib/job-plan'

const matches = (query: string, ...fields: (string | null)[]) => {
  const q = query.trim().toLowerCase()
  return !q || fields.some((f) => f?.toLowerCase().includes(q))
}

function Field({
  id,
  label,
  value,
  onChange,
  inputMode,
}: {
  id: string
  label: string
  value: string
  onChange: (v: string) => void
  inputMode?: 'decimal' | 'tel'
}) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm">
        {label}
      </label>
      <Input
        id={id}
        inputMode={inputMode}
        className="h-12 text-base"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  )
}

function ListScreen({
  title,
  intro,
  search,
  setSearch,
  showArchived,
  setShowArchived,
  archivedCount,
  filters,
  adding,
  loading,
  failed,
  retry,
  children,
}: {
  title: string
  intro: string
  search: string
  setSearch: (v: string) => void
  showArchived: boolean
  setShowArchived: (v: boolean) => void
  /** null: the count is not known (a server-paged list), the toggle is always offered. */
  archivedCount: number | null
  filters?: ReactNode
  adding: ReactNode
  loading: boolean
  failed: boolean
  retry: () => void
  children: ReactNode
}) {
  const id = useId()
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
      <BackToSettings />
      <h1 className="text-section text-ink font-medium">{title}</h1>
      <p className="text-muted-foreground">{intro}</p>
      {adding}
      <div className="flex flex-col gap-1">
        <label htmlFor={`${id}-search`} className="text-sm font-medium">
          Search
        </label>
        <Input
          id={`${id}-search`}
          type="search"
          className="h-12 text-base"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      {filters}
      {(archivedCount === null || archivedCount > 0) && (
        <label className="flex min-h-12 items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-5"
            checked={showArchived}
            onChange={(e) => setShowArchived(e.target.checked)}
          />
          Show archived{archivedCount === null ? '' : ` (${archivedCount})`}
        </label>
      )}
      {failed ? (
        <Alert variant="destructive" role="alert">
          <AlertTitle>Could not load the list</AlertTitle>
          <AlertDescription>
            <Button variant="outline" className="mt-2 h-12" onClick={retry}>
              Try again
            </Button>
          </AlertDescription>
        </Alert>
      ) : loading ? (
        <Skeleton className="h-48 w-full" />
      ) : (
        children
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------------------------

function ProductForm({ product, onDone }: { product: Product | null; onDone: () => void }) {
  const id = useId()
  const add = useAddProduct()
  const update = useUpdateProduct()
  const [name, setName] = useState(product?.name ?? '')
  const [unit, setUnit] = useState(product?.unit ?? 'each')
  const [price, setPrice] = useState(product ? priceText(product.price_cents) : '')
  const [supplier, setSupplier] = useState(product?.supplier ?? '')
  const [problem, setProblem] = useState<string | null>(null)
  const busy = add.isPending || update.isPending
  return (
    <form
      noValidate
      className="flex flex-col gap-3 rounded-md border p-3"
      onSubmit={(e) => {
        e.preventDefault()
        const cents = parseEuroToCents(price)
        if (name.trim().length < 2) return setProblem('Enter a name of at least 2 letters.')
        if (!unit.trim()) return setProblem('Enter a unit, for example each, m2 or bag.')
        if (cents === null)
          return setProblem('Enter the usual price each in euro, for example 24.50.')
        setProblem(null)
        const input = {
          name: name.trim(),
          unit: unit.trim(),
          priceCents: cents,
          supplier: supplier.trim(),
        }
        if (product) update.mutate({ id: product.id, ...input }, { onSuccess: onDone })
        else add.mutate(input, { onSuccess: onDone })
      }}
    >
      <Field id={`${id}-name`} label="Name" value={name} onChange={setName} />
      <div className="grid grid-cols-2 gap-2">
        <Field
          id={`${id}-price`}
          label="Usual price each (€)"
          inputMode="decimal"
          value={price}
          onChange={setPrice}
        />
        <Field id={`${id}-unit`} label="Unit" value={unit} onChange={setUnit} />
      </div>
      <Field
        id={`${id}-supplier`}
        label="Supplier (optional)"
        value={supplier}
        onChange={setSupplier}
      />
      {product && (
        <p className="text-muted-foreground text-xs">
          A new usual price is used for items added from now on. Jobs already planned keep the price
          they were planned at.
          {product.source &&
            ` If you change the price, later ${sourceName(product)} updates keep yours and show theirs beside it.`}
        </p>
      )}
      {problem && (
        <p role="alert" className="text-destructive text-sm">
          {problem}
        </p>
      )}
      {(add.isError || update.isError) && (
        <p role="alert" className="text-destructive text-sm">
          Not saved. A product with this name may already exist.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="outline" className="h-12 px-5" disabled={busy}>
          {busy ? 'Saving…' : 'Save'}
        </Button>
        <Button type="button" variant="ghost" className="h-12" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  )
}

function ProductRow({ product }: { product: Product }) {
  const [editing, setEditing] = useState(false)
  const archive = useArchiveProduct()
  const from = sourceName(product)
  if (editing)
    return (
      <li className="py-2">
        <ProductForm product={product} onDone={() => setEditing(false)} />
      </li>
    )
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 border-t py-2">
      <div className="min-w-0">
        <p
          className={`font-medium break-words ${product.archived_at ? 'text-muted-foreground' : ''}`}
        >
          {product.name}
          {product.archived_at && ' (archived)'}
        </p>
        <p className="text-muted-foreground text-sm">{productPriceLine(product)}</p>
        {product.category && (
          <p className="text-muted-foreground text-xs break-words">{product.category}</p>
        )}
        {(product.uses ?? 0) > 0 && (
          <p className="text-muted-foreground text-xs">
            On {product.uses} job {product.uses === 1 ? 'line' : 'lines'}
          </p>
        )}
        {from && product.source_url && (
          <a
            href={product.source_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary inline-flex min-h-12 items-center text-sm underline"
          >
            View on {from}
            <span className="sr-only"> (opens in a new tab): {product.name}</span>
          </a>
        )}
      </div>
      <div className="flex gap-2">
        <Button variant="outline" className="h-12" onClick={() => setEditing(true)}>
          Change<span className="sr-only"> {product.name}</span>
        </Button>
        <Button
          variant="ghost"
          className="h-12"
          disabled={archive.isPending}
          onClick={() => archive.mutate({ id: product.id, archived: !product.archived_at })}
        >
          {product.archived_at ? 'Bring back' : 'Archive'}
          <span className="sr-only"> {product.name}</span>
        </Button>
      </div>
      {archive.isError && (
        <p role="alert" className="text-destructive w-full text-sm">
          Not saved. Try again.
        </p>
      )}
    </li>
  )
}

/** The list's views: his own and what he has used (the default), or a supplier catalogue. */
const PRODUCT_FILTERS: { value: ProductFilter; label: string }[] = [
  { value: 'mine_used', label: 'Mine and used' },
  { value: 'mine', label: 'Mine' },
  { value: 'used', label: 'Used on jobs' },
  ...Object.entries(SOURCE_NAMES).map(([value, label]) => ({ value, label })),
  { value: 'all', label: 'All' },
]

export function ProductsPage() {
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<ProductFilter>('mine_used')
  const [showArchived, setShowArchived] = useState(false)
  const [adding, setAdding] = useState(false)
  const asked = useSettledValue(search)
  const products = useProductBrowse(filter, asked, showArchived)
  const shown = products.data?.pages.flat() ?? []
  const total = products.data?.pages[0]?.[0]?.total ?? 0
  return (
    <ListScreen
      title="Product list"
      intro="Your own products, the ones you have used on jobs, and supplier catalogues. Catalogue prices include VAT."
      search={search}
      setSearch={setSearch}
      showArchived={showArchived}
      setShowArchived={setShowArchived}
      archivedCount={null}
      loading={products.isPending}
      failed={products.isError}
      retry={() => void products.refetch()}
      filters={
        <fieldset className="flex flex-col gap-1">
          <legend className="mb-1 text-sm font-medium">Show</legend>
          <div className="flex flex-wrap gap-2">
            {PRODUCT_FILTERS.map((f) => (
              <label
                key={f.value}
                className="border-edge has-checked:border-action has-checked:bg-action flex min-h-12 cursor-pointer items-center rounded-full border px-4 has-checked:text-white has-focus-visible:outline-3 has-focus-visible:outline-offset-3"
              >
                <input
                  type="radio"
                  name="product-filter"
                  className="sr-only"
                  checked={filter === f.value}
                  onChange={() => setFilter(f.value)}
                />
                {f.label}
              </label>
            ))}
          </div>
        </fieldset>
      }
      adding={
        adding ? (
          <ProductForm product={null} onDone={() => setAdding(false)} />
        ) : (
          <Button
            variant="outline"
            className="h-12 self-start px-5"
            onClick={() => setAdding(true)}
          >
            Add a product
          </Button>
        )
      }
    >
      {shown.length === 0 ? (
        <p className="text-muted-foreground">
          {asked
            ? 'No product matches that search.'
            : filter === 'mine_used' || filter === 'mine'
              ? 'No products of your own yet. Add one here or type an item on a job plan.'
              : 'Nothing here yet.'}
        </p>
      ) : (
        <>
          <p className="text-muted-foreground text-sm" aria-live="polite">
            Showing {shown.length} of {total}
          </p>
          <ul aria-label="Products" className="flex flex-col">
            {shown.map((p) => (
              <ProductRow key={p.id} product={p} />
            ))}
          </ul>
          {products.hasNextPage && (
            <Button
              variant="outline"
              className="h-12 self-start px-5"
              disabled={products.isFetchingNextPage}
              onClick={() => void products.fetchNextPage()}
            >
              {products.isFetchingNextPage ? 'Loading…' : 'Show more'}
            </Button>
          )}
        </>
      )}
    </ListScreen>
  )
}

/** The search box's value once typing pauses, so the server is asked once per pause. */
function useSettledValue(value: string, ms = 250) {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    const t = window.setTimeout(() => setSettled(value), ms)
    return () => window.clearTimeout(t)
  }, [value, ms])
  return settled
}

// ---------------------------------------------------------------------------------------------
// Tradespeople
// ---------------------------------------------------------------------------------------------

function PersonForm({ person, onDone }: { person: Tradesperson | null; onDone: () => void }) {
  const id = useId()
  const add = useAddTradesperson()
  const update = useUpdateTradesperson()
  const [name, setName] = useState(person?.name ?? '')
  const [trade, setTrade] = useState(person?.trade ?? '')
  const [phone, setPhone] = useState(person?.phone ?? '')
  const [problem, setProblem] = useState<string | null>(null)
  const busy = add.isPending || update.isPending
  return (
    <form
      noValidate
      className="flex flex-col gap-3 rounded-md border p-3"
      onSubmit={(e) => {
        e.preventDefault()
        if (!name.trim()) return setProblem('Enter their name.')
        setProblem(null)
        const input = { name: name.trim(), trade: trade.trim(), phone: phone.trim() }
        if (person) update.mutate({ id: person.id, ...input }, { onSuccess: onDone })
        else add.mutate(input, { onSuccess: onDone })
      }}
    >
      <Field id={`${id}-name`} label="Name" value={name} onChange={setName} />
      <Field id={`${id}-trade`} label="Trade (optional)" value={trade} onChange={setTrade} />
      <Field
        id={`${id}-phone`}
        label="Phone (optional)"
        inputMode="tel"
        value={phone}
        onChange={setPhone}
      />
      {problem && (
        <p role="alert" className="text-destructive text-sm">
          {problem}
        </p>
      )}
      {(add.isError || update.isError) && (
        <p role="alert" className="text-destructive text-sm">
          Not saved. Someone with this name may already be on the list.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="outline" className="h-12 px-5" disabled={busy}>
          {busy ? 'Saving…' : 'Save'}
        </Button>
        <Button type="button" variant="ghost" className="h-12" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  )
}

function PersonRow({ person }: { person: Tradesperson }) {
  const [editing, setEditing] = useState(false)
  const archive = useArchiveTradesperson()
  if (editing)
    return (
      <li className="py-2">
        <PersonForm person={person} onDone={() => setEditing(false)} />
      </li>
    )
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 border-t py-2">
      <div className="min-w-0">
        <p
          className={`font-medium break-words ${person.archived_at ? 'text-muted-foreground' : ''}`}
        >
          {person.name}
          {person.archived_at && ' (archived)'}
        </p>
        <p className="text-muted-foreground text-sm">
          {[person.trade, person.phone].filter(Boolean).join(' · ') || 'No trade or phone'}
        </p>
      </div>
      <div className="flex gap-2">
        {person.phone && (
          <a
            href={`tel:${person.phone.replace(/[^\d+]/g, '')}`}
            className="text-primary inline-flex min-h-12 items-center px-2 text-sm underline"
          >
            Ring<span className="sr-only"> {person.name}</span>
          </a>
        )}
        <Button variant="outline" className="h-12" onClick={() => setEditing(true)}>
          Change<span className="sr-only"> {person.name}</span>
        </Button>
        <Button
          variant="ghost"
          className="h-12"
          disabled={archive.isPending}
          onClick={() => archive.mutate({ id: person.id, archived: !person.archived_at })}
        >
          {person.archived_at ? 'Bring back' : 'Archive'}
          <span className="sr-only"> {person.name}</span>
        </Button>
      </div>
      {archive.isError && (
        <p role="alert" className="text-destructive w-full text-sm">
          Not saved. Try again.
        </p>
      )}
    </li>
  )
}

export function TradespeoplePage() {
  const people = useTradespeople()
  const [search, setSearch] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const [adding, setAdding] = useState(false)
  const all = people.data ?? []
  const shown = all.filter(
    (p) => (showArchived || !p.archived_at) && matches(search, p.name, p.trade, p.phone),
  )
  return (
    <ListScreen
      title="Tradespeople"
      intro="The people you give stages to on a job plan. They are not users and nothing is sent to them."
      search={search}
      setSearch={setSearch}
      showArchived={showArchived}
      setShowArchived={setShowArchived}
      archivedCount={all.filter((p) => p.archived_at).length}
      loading={people.isPending}
      failed={people.isError}
      retry={() => void people.refetch()}
      adding={
        adding ? (
          <PersonForm person={null} onDone={() => setAdding(false)} />
        ) : (
          <Button
            variant="outline"
            className="h-12 self-start px-5"
            onClick={() => setAdding(true)}
          >
            Add a tradesperson
          </Button>
        )
      }
    >
      {shown.length === 0 ? (
        <p className="text-muted-foreground">
          {all.length === 0
            ? 'No one yet. Add someone here or on a job plan.'
            : 'No one matches that search.'}
        </p>
      ) : (
        <ul aria-label="Tradespeople" className="flex flex-col">
          {shown.map((p) => (
            <PersonRow key={p.id} person={p} />
          ))}
        </ul>
      )}
    </ListScreen>
  )
}
