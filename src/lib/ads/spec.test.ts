import { describe, expect, it } from 'vitest'
import { exportFilename, htmlProblems, PLACEMENTS, safeArea } from './spec'

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
    ['<script>fetch("/x")</script>', 'scripts are not allowed in a still ad'],
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
