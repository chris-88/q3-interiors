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
 * An ad at its true proportions, scaled to the width available. Isolation: the HTML goes in as
 * srcdoc of a sandboxed frame with no allowances, so it runs no scripts and has an opaque origin
 * (it cannot read this page, its storage or the staff session), and its own CSP blocks every
 * network request.
 */
export function AdFrame({
  html,
  width,
  height,
  title,
}: {
  html: string
  width: number
  height: number
  title: string
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
        title={title}
        sandbox=""
        referrerPolicy="no-referrer"
        srcDoc={withFrameCsp(html)}
        width={width}
        height={height}
        className="absolute top-0 left-0 border-0"
        style={{ transform: `scale(${scale})`, transformOrigin: '0 0' }}
      />
    </div>
  )
}
