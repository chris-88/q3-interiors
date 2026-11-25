import { useEffect, useRef, useState } from 'react'

/**
 * The policy inside the preview frame: nothing may load from anywhere (fonts, images and styles
 * are inlined in a published ad), no scripts, no forms, no navigation.
 */
export const AD_FRAME_CSP =
  "default-src 'none'; img-src data:; font-src data:; media-src data:; style-src 'unsafe-inline'; form-action 'none'; base-uri 'none'"

/** The ad's HTML with the frame's Content-Security-Policy as the first thing in <head>. */
export function withFrameCsp(html: string): string {
  const meta = `<meta http-equiv="Content-Security-Policy" content="${AD_FRAME_CSP}">`
  if (/<head\b[^>]*>/i.test(html)) return html.replace(/<head\b[^>]*>/i, (head) => `${head}${meta}`)
  return `<!doctype html><html><head>${meta}</head><body>${html}</body></html>`
}

/**
 * Pausing without scripts: the frame is made one pixel wider than the ad (the extra column is
 * clipped), and this rule in the frame pauses every animation at that width. The animations hold
 * where they are, and narrowing the frame again lets them carry on.
 */
export function withPauseRule(html: string, width: number): string {
  const rule = `<style>@media (min-width: ${width + 1}px) { *, *::before, *::after { animation-play-state: paused !important; } }</style>`
  return /<\/head>/i.test(html) ? html.replace(/<\/head>/i, `${rule}</head>`) : `${html}${rule}`
}

/**
 * An ad at its true proportions, scaled to the width available. Isolation: the HTML goes in as
 * srcdoc of a sandboxed frame with no allowances, so it runs no scripts and has an opaque origin
 * (it cannot read this page, its storage or the staff session), and its own CSP blocks every
 * network request. CSS animations run without scripts; `paused` holds them (see withPauseRule) and
 * a new `run` number reloads the frame, which starts the loop again.
 */
export function AdFrame({
  html,
  width,
  height,
  title,
  paused = false,
  run = 0,
}: {
  html: string
  width: number
  height: number
  title: string
  paused?: boolean
  run?: number
}) {
  const box = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(0.25)
  useEffect(() => {
    const el = box.current
    if (!el) return
    const update = () => setScale(el.clientWidth / width)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
  }, [width])
  return (
    <div
      ref={box}
      className="border-rule relative w-full overflow-hidden border bg-white"
      style={{ aspectRatio: `${width} / ${height}` }}
    >
      <iframe
        key={run}
        title={title}
        sandbox=""
        referrerPolicy="no-referrer"
        srcDoc={withPauseRule(withFrameCsp(html), width)}
        width={paused ? width + 1 : width}
        height={height}
        className="absolute top-0 left-0 border-0"
        style={{ transform: `scale(${scale})`, transformOrigin: '0 0' }}
      />
    </div>
  )
}
