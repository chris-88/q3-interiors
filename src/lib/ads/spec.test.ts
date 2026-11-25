import { describe, expect, it } from 'vitest'
import {
  durationProblem,
  exportFilename,
  formatDuration,
  htmlProblems,
  PLACEMENTS,
  safeArea,
} from './spec'

const clean = `<!doctype html><html><head><style>
@font-face { font-family: Roboto; src: url(data:font/woff2;base64,AAAA) format('woff2'); }
body { margin: 0 }</style></head>
<body><img src="data:image/svg+xml;base64,PHN2Zz4=" alt=""><a href="#top">x</a></body></html>`

describe('ad placements', () => {
  it('use Meta’s sizes and covered areas', () => {
    expect(PLACEMENTS.portrait).toMatchObject({ width: 1440, height: 1800 })
    expect(PLACEMENTS.vertical).toMatchObject({ width: 1440, height: 2560 })
    expect(safeArea(PLACEMENTS.vertical)).toEqual({ left: 86, top: 358, width: 1268, height: 1306 })
  })

  it('name downloads plainly', () => {
    expect(exportFilename('Sample: Planning a renovation?', 1, PLACEMENTS.vertical)).toBe(
      'q3-sample-planning-a-renovation-v1-9x16-1440x2560.png',
    )
    expect(exportFilename('Sample', 2, PLACEMENTS.portrait, 'mp4')).toBe(
      'q3-sample-v2-4x5-1440x1800.mp4',
    )
  })
})

describe('animated ads', () => {
  it('accept a loop of whole frames between 1 and 15 seconds', () => {
    expect(durationProblem(6000)).toBeNull()
    expect(durationProblem(1000)).toBeNull()
    expect(durationProblem(15000)).toBeNull()
    expect(durationProblem(900)).toMatch(/between/)
    expect(durationProblem(16000)).toMatch(/between/)
    expect(durationProblem(6010)).toMatch(/whole number of frames/)
    expect(durationProblem('6000')).toMatch(/whole number/)
  })

  it('say the length plainly', () => {
    expect(formatDuration(6000)).toBe('6 seconds')
    expect(formatDuration(2500)).toBe('2.5 seconds')
    expect(formatDuration(1000)).toBe('1 second')
  })

  it('may use CSS keyframes', () => {
    const css = `<style>@keyframes wipe { from { clip-path: inset(0 100% 0 0) } to { clip-path: inset(0) } }
      .ad-rule { animation: wipe 6s ease-in-out infinite }</style>`
    expect(htmlProblems(css)).toEqual([])
  })
})

describe('published ad files', () => {
  it('pass when everything is inlined', () => {
    expect(htmlProblems(clean)).toEqual([])
  })

  it.each([
    ['<img src="https://example.com/a.png">', 'external or unresolved reference'],
    ['<img src="assets/photo.jpg">', 'external or unresolved reference'],
    ['<img src="//cdn.example.com/a.png">', 'external or unresolved reference'],
    [
      '<div style="background:url(https://x.example/b.jpg)"></div>',
      'external or unresolved reference',
    ],
    [
      '<style>@import "https://fonts.example.com/x.css";</style>',
      'external or unresolved reference',
    ],
    ['<img srcset="a.png 1x, data:image/png;base64,AA 2x">', 'external or unresolved reference'],
    ['<link rel="stylesheet" href="kit:ad.css">', 'linked files are not allowed (inline the CSS)'],
    ['<script>fetch("/x")</script>', 'scripts are not allowed in an ad (animate with CSS)'],
    [
      '<video autoplay muted src="data:video/mp4;base64,AA"></video>',
      'video and audio elements are not allowed (animate with CSS)',
    ],
    ['<svg><animate attributeName="x" dur="1s"/></svg>', 'SVG animation is not allowed (use CSS)'],
    [
      '<img src="data:image/png;base64,AA" onload="go()">',
      'event handler attributes are not allowed',
    ],
    ['<iframe srcdoc="x"></iframe>', 'embedded documents are not allowed'],
    ['<p>Visit www.example.com or https://q3.example</p>', 'a web address appears in the file'],
  ])('refuse %s', (html, problem) => {
    expect(htmlProblems(html).map((p) => p.problem)).toContain(problem)
  })
})
