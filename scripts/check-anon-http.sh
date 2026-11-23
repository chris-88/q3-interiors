#!/usr/bin/env bash
# Live check through the public gateway with the anon key: every table read or write must be
# refused, and the submission function must reach validation. Writes nothing.
#   scripts/check-anon-http.sh   (reads VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY from .env.local)
set -euo pipefail
cd "$(dirname "$0")/.."
url="$(grep '^VITE_SUPABASE_URL=' .env.local | cut -d= -f2-)"
key="$(grep '^VITE_SUPABASE_ANON_KEY=' .env.local | cut -d= -f2-)"
rest="$url/rest/v1"
headers=(-H "apikey: $key" -H "Authorization: Bearer $key" -H 'content-type: application/json')
fail=0

expect_code() {
  local what="$1" want="$2" body="$3"
  if [[ "$body" == *"\"code\":\"$want\""* ]]; then
    echo "ok    $what"
  else
    echo "FAIL  $what: $body"
    fail=1
  fi
}

for table in enquiries form_versions staff enquiry_revisions enquiry_attribution enquiry_events \
  bookings appointment_types staff_availability calendar_connections integration_jobs communications \
  booking_settings; do
  expect_code "anon cannot select $table" 42501 "$(curl -s "$rest/$table?select=*" "${headers[@]}")"
done
expect_code "anon cannot update enquiries" 42501 \
  "$(curl -s -X PATCH "$rest/enquiries?id=not.is.null" "${headers[@]}" -d '{"status":"contacted"}')"
expect_code "anon cannot insert enquiries" 42501 \
  "$(curl -s -X POST "$rest/enquiries" "${headers[@]}" -d '{"reference":"Q3-AAAAAA"}')"
expect_code "anon cannot change status" 42501 \
  "$(curl -s -X POST "$rest/rpc/set_enquiry_status" "${headers[@]}" \
    -d '{"p_enquiry_id":"00000000-0000-4000-8000-000000000000","p_status":"contacted"}')"
expect_code "submit_enquiry validates on the server" 22023 \
  "$(curl -s -X POST "$rest/rpc/submit_enquiry" "${headers[@]}" \
    -d '{"p_idempotency_key":"00000000-0000-4000-8000-000000000000","p_form_id":"enquiry","p_form_version":1,"p_answers":{}}')"
expect_code "anon cannot run the funnel report" 42501 \
  "$(curl -s -X POST "$rest/rpc/funnel_report" "${headers[@]}" -d '{"p_from":"2026-01-01","p_to":"2026-12-31"}')"
expect_code "anon cannot resolve tokens directly" 42501 \
  "$(curl -s -X POST "$rest/rpc/resolve_enquiry_token" "${headers[@]}" -d '{"p_token":"x"}')"

# Edge Functions (slice 2).
functions="$url/functions/v1"
check() { # what, expected, actual
  if [[ "$3" == "$2" ]]; then echo "ok    $1"; else echo "FAIL  $1: got $3"; fail=1; fi
}
check "public-booking refuses an unknown token" '{"error":"invalid_token"}' \
  "$(curl -s -X POST "$functions/public-booking" "${headers[@]}" \
    -d '{"action":"context","token":"not-a-real-token-0000000000"}')"
check "booking-worker refuses a call without the worker secret" '{"error":"forbidden"}' \
  "$(curl -s -X POST "$functions/booking-worker" "${headers[@]}" -d '{}')"
check "calendar-admin refuses a caller who is not staff" '{"error":"forbidden"}' \
  "$(curl -s -X POST "$functions/calendar-admin" "${headers[@]}" -d '{"action":"start"}')"
check "the OAuth callback is reachable without a JWT and refuses a bad state" \
  "https://q3.chrisquinn.ie/#/staff/settings?calendar=error&reason=expired" \
  "$(curl -s -o /dev/null -w '%{redirect_url}' "$functions/google-oauth-callback?state=bad&code=x")"
exit "$fail"
