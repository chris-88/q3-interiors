#!/usr/bin/env bash
# Proves the two builds are split: the customer bundle carries no staff screens and the staff
# bundle no customer journey. Run after `npm run build`.
set -euo pipefail
cd "$(dirname "$0")/.."

fail=0
has() { grep -rqF -- "$2" "$1"; }
expect_absent() {
  if has "$1" "$2"; then echo "FAIL  $1 contains \"$2\""; fail=1; else echo "ok    $1 has no \"$2\""; fi
}
expect_present() {
  if has "$1" "$2"; then echo "ok    $1 has \"$2\""; else echo "FAIL  $1 lacks \"$2\""; fail=1; fi
}

# Staff-only strings must not reach the customer site.
expect_absent dist 'Who takes bookings'
expect_absent dist 'Staff sign in'
expect_absent dist 'Go-live checklist'
expect_absent dist 'staff-accounts'
expect_absent dist 'ad_variants'
expect_absent dist 'request_ad_change'
expect_absent dist 'Download the image'
# The customer journey must not reach the staff site.
expect_absent dist-staff 'Planning a home renovation?'
expect_absent dist-staff 'What kind of project is it?'
# Each has its own.
expect_present dist 'Planning a home renovation?'
expect_present dist-staff 'Who takes bookings'
expect_present dist-staff 'ad_variants'
expect_present dist-staff/CNAME 'staff.q3interiors.ie'
expect_present dist-staff/robots.txt 'Disallow: /'
expect_present dist-staff/index.html 'noindex'
# Only the staff console is an installable app.
expect_absent dist/index.html 'manifest'
if [[ -e dist/sw.js || -e dist/manifest.webmanifest ]]; then echo "FAIL  dist has a service worker or manifest"; fail=1; else echo "ok    dist has no service worker or manifest"; fi
expect_present dist-staff/index.html 'rel="manifest"'
expect_present dist-staff/manifest.webmanifest '"display": "standalone"'
expect_present dist-staff/sw.js 'q3-staff-shell-'
exit "$fail"
