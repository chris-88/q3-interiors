// Finishes the staff build (dist-staff/) for its own GitHub Pages repo: the custom domain, no
// Jekyll, and no indexing. Removes what only the customer site needs.
const fs = require('node:fs')
const path = require('node:path')

const out = path.resolve(__dirname, '..', 'dist-staff')
if (!fs.existsSync(path.join(out, 'index.html'))) throw new Error('build the staff site first')

fs.writeFileSync(path.join(out, 'CNAME'), 'staff.q3interiors.ie\n')
fs.writeFileSync(path.join(out, '.nojekyll'), '')
fs.writeFileSync(path.join(out, 'robots.txt'), 'User-agent: *\nDisallow: /\n')
fs.rmSync(path.join(out, 'og'), { recursive: true, force: true })
console.log('dist-staff: CNAME staff.q3interiors.ie, .nojekyll, robots.txt (Disallow: /)')
