// One document viewer for everything staff check or look back at: the estimate email, the quote
// and its PDF (review P6). The document is shown exactly as it goes out, in a sandboxed frame (no
// scripts, opaque origin); the lines above it say who it goes to and what it is.
import type { ReactNode } from 'react'
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
        title={title}
        sandbox=""
        srcDoc={html}
        className={`w-full rounded-md border bg-white ${tall ? 'h-[48rem]' : 'h-[36rem]'}`}
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
