/** A filter chip: a native radio inside a 48px pill (the Ads screens' pattern). */
export const chip =
  'relative border-edge has-[:checked]:border-action has-[:checked]:bg-action has-[:focus-visible]:outline-action inline-flex min-h-12 shrink-0 cursor-pointer items-center rounded-full border px-4 text-sm has-[:checked]:text-white has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-solid'

/** One row of chips (radios), scrolling sideways on a narrow screen; counts when given. */
export function Chips<K extends string>({
  name,
  legend,
  options,
  value,
  counts,
  onChange,
}: {
  name: string
  legend: string
  options: readonly (readonly [K, string])[]
  value: K
  counts?: Record<K, number>
  onChange: (key: K) => void
}) {
  return (
    <fieldset className="min-w-0">
      <legend className="sr-only">{legend}</legend>
      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
        {options.map(([key, label]) => (
          <label key={key} className={chip}>
            <input
              type="radio"
              name={name}
              className="sr-only"
              checked={value === key}
              onChange={() => onChange(key)}
            />
            {label}
            {counts && ' '}
            {counts && <span className="ms-1.5 tabular-nums opacity-70">{counts[key]}</span>}
          </label>
        ))}
      </div>
    </fieldset>
  )
}
