// One document viewer for everything staff check or look back at: the estimate email, the quote
// and its PDF (review P6). The document is shown exactly as it goes out, in a sandboxed frame
// with scripts off; the lines above it say who it goes to and what it is. The frame takes the
// document's own height, so the page scrolls rather than a box inside it. Measuring that needs
// `allow-same-origin` (the console reads the frame's height); with scripts off the document,
// which our own renderers produced, still cannot run anything.
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'

export function DocumentViewer({
  title,
  html,
  lines,
  tall = false,
  pdf,
}: {
  /** The frame's accessible name, e.g. "Estimate email" or "Quote Q3-Q-0007". */
  title: string
  html: string
  /** Who it goes to, the subject, how long it is good for. */
  lines?: ReactNode[]
  /** A4 documents (the quote) get a taller frame than an email. */
  tall?: boolean
  /** The stored PDF, when there is one. */
  pdf?: { ready: boolean; busy: boolean; failed: boolean; onDownload: () => void }
}) {
  const frame = useRef<HTMLIFrameElement>(null)
  const [height, setHeight] = useState<number | null>(null)
  const measure = useCallback(() => {
    const doc = frame.current?.contentDocument
    if (!doc?.documentElement) return
    setHeight(doc.documentElement.scrollHeight)
    // Web fonts can arrive after load and change the height.
    void doc.fonts?.ready.then(() => setHeight(doc.documentElement.scrollHeight))
  }, [])
  // A narrower or wider frame reflows the document: measure again.
  useEffect(() => {
    const el = frame.current
    if (!el || typeof ResizeObserver === 'undefined') return
    let width = el.clientWidth
    const watch = new ResizeObserver(() => {
      if (el.clientWidth !== width) {
        width = el.clientWidth
        measure()
      }
    })
    watch.observe(el)
    return () => watch.disconnect()
  }, [measure])
  return (
    <div className="flex flex-col gap-2">
      {lines && lines.length > 0 && (
        <ul className="text-muted-foreground flex flex-col gap-0.5 text-sm">
          {lines.map((line, i) => (
            <li key={i} className="break-words">
              {line}
            </li>
          ))}
        </ul>
      )}
      <iframe
        ref={frame}
        title={title}
        sandbox="allow-same-origin"
        srcDoc={html}
        onLoad={measure}
        style={height ? { height: height + 2 } : undefined}
        className={`w-full overflow-hidden rounded-md border bg-white ${height ? '' : tall ? 'h-[48rem]' : 'h-[36rem]'}`}
      />
      {pdf && (
        <>
          <Button
            variant="outline"
            className="h-12 self-start sm:px-6"
            disabled={!pdf.ready || pdf.busy}
            onClick={pdf.onDownload}
          >
            {pdf.ready ? 'Download PDF' : 'PDF not made yet'}
          </Button>
          {pdf.failed && (
            <p role="alert" className="text-destructive text-sm">
              Could not download the PDF.
            </p>
          )}
        </>
      )}
    </div>
  )
}
