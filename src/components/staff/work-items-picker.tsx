import { useState } from 'react'
import { Check, X } from 'lucide-react'
import {
  offeredItems,
  tidyWorkItem,
  useAddWorkItem,
  useRemoveWorkItem,
  useWorkItems,
  WORK_ITEM_MAX,
  WORK_ITEM_MIN,
  type WorkItem,
} from '@/api/estimates'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'

/**
 * The ticked labels in the order the form shows them: offered items first, in their order, then
 * any ticked label the list does not hold (just added, or removed meanwhile) in the order ticked.
 */
export function orderTicked(offered: WorkItem[], ticked: string[]): string[] {
  const key = (s: string) => s.toLowerCase()
  const chosen = new Set(ticked.map(key))
  const inList = offered.filter((i) => chosen.has(key(i.label))).map((i) => i.label)
  const listed = new Set(offered.map((i) => key(i.label)))
  return [...inList, ...ticked.filter((t) => !listed.has(key(t)))]
}

const chip =
  'border-edge has-[:checked]:border-action has-[:checked]:bg-action has-[:focus-visible]:outline-action relative inline-flex min-h-12 cursor-pointer items-center gap-2 rounded-full border px-4 text-base has-[:checked]:text-white has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-solid'

/** "Work we looked at": tap the items, add one the list lacks, or remove one in Edit list. */
export function WorkItemsPicker({
  projectType,
  ticked,
  onChange,
  invalid,
  after = 'visit',
}: {
  /** The enquiry's project type value; null offers the "any job" items only. */
  projectType: string | null
  ticked: string[]
  onChange: (ticked: string[]) => void
  invalid?: boolean
  /** After a call the work was talked about, not looked at. */
  after?: 'visit' | 'call'
}) {
  const items = useWorkItems()
  const add = useAddWorkItem()
  const remove = useRemoveWorkItem()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const offered = offeredItems(items.data ?? [], projectType)
  const isTicked = (label: string) => ticked.some((t) => t.toLowerCase() === label.toLowerCase())
  const toggle = (label: string) =>
    onChange(
      isTicked(label)
        ? ticked.filter((t) => t.toLowerCase() !== label.toLowerCase())
        : [...ticked, label],
    )
  // Ticked labels the list does not show (added just now, before the list reloads).
  const extra = orderTicked(offered, ticked).filter(
    (t) => !offered.some((i) => i.label.toLowerCase() === t.toLowerCase()),
  )

  const addOne = () => {
    const label = tidyWorkItem(draft)
    if (!label) {
      setProblem(`Write ${WORK_ITEM_MIN} to ${WORK_ITEM_MAX} characters.`)
      document.getElementById('work-item-new')?.focus()
      return
    }
    setProblem(null)
    if (!isTicked(label)) onChange([...ticked, label])
    setDraft('')
    add.mutate({ projectType, label })
  }

  return (
    <fieldset className="flex min-w-0 flex-col gap-2" aria-describedby="work-items-hint">
      <legend className="mb-1 flex w-full items-center justify-between gap-2 text-sm font-medium">
        <span>{after === 'call' ? 'Work we talked about' : 'Work we looked at'}</span>
        {offered.length > 0 && (
          <Button
            type="button"
            variant="ghost"
            className="h-12 px-2 text-sm underline underline-offset-4"
            aria-pressed={editing}
            onClick={() => setEditing((x) => !x)}
          >
            {editing ? 'Done' : 'Edit list'}
          </Button>
        )}
      </legend>
      <p id="work-items-hint" className="text-muted-foreground -mt-1 text-xs">
        {editing
          ? 'Remove an item to stop offering it. Estimates already sent keep it.'
          : `Tap what you ${after === 'call' ? 'talked about' : 'looked at'}. The customer sees them as a list.`}
      </p>
      {items.isPending ? (
        <Skeleton className="h-28 w-full" />
      ) : items.isError ? (
        <p role="alert" className="text-destructive text-sm">
          Could not load the list. Add items below or write a note.
        </p>
      ) : editing ? (
        <ul className="flex flex-wrap gap-2" aria-label="Items offered">
          {offered.map((item) => (
            <li key={item.id}>
              <Button
                type="button"
                variant="outline"
                className="h-12 rounded-full"
                disabled={remove.isPending}
                aria-label={`Remove ${item.label}`}
                onClick={() => {
                  remove.mutate(item.id)
                  if (isTicked(item.label)) toggle(item.label)
                }}
              >
                {item.label}
                <X aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="flex flex-wrap gap-2">
          {[...offered.map((i) => i.label), ...extra].map((label) => (
            <label key={label} className={chip}>
              <input
                type="checkbox"
                className="sr-only"
                checked={isTicked(label)}
                onChange={() => toggle(label)}
                aria-invalid={invalid ? true : undefined}
              />
              {isTicked(label) && <Check className="size-4" aria-hidden="true" />}
              {label}
            </label>
          ))}
        </div>
      )}
      {remove.isError && (
        <p role="alert" className="text-destructive text-sm">
          The item was not removed. Try again.
        </p>
      )}
      {!editing && (
        <div className="flex flex-col gap-1">
          <label htmlFor="work-item-new" className="text-sm">
            Add another
          </label>
          <div className="flex gap-2">
            <Input
              id="work-item-new"
              className="h-12 flex-1 text-base"
              value={draft}
              maxLength={WORK_ITEM_MAX + 10}
              onChange={(e) => {
                setDraft(e.target.value)
                setProblem(null)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  addOne()
                }
              }}
              aria-invalid={problem ? true : undefined}
              aria-describedby={problem ? 'work-item-new-error' : undefined}
            />
            <Button
              type="button"
              variant="outline"
              className="h-12 px-5"
              disabled={add.isPending}
              onClick={addOne}
            >
              Add
            </Button>
          </div>
          {problem && (
            <p id="work-item-new-error" role="alert" className="text-destructive text-sm">
              {problem}
            </p>
          )}
          {add.isError && (
            <p role="alert" className="text-destructive text-sm">
              Ticked for this estimate, but not saved for next time. Try again later.
            </p>
          )}
        </div>
      )}
    </fieldset>
  )
}
