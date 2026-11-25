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

# Cloudflare rate-limits the public API (50 requests per 10 seconds per address). This script tests
# the public URL on purpose, so it paces itself: a 3-second pause after every 8 requests keeps it
# under about 27 a window, and two runs in a row pass. (curl runs in subshells, hence the file.)
pace_file="$(mktemp)"
trap 'rm -f "$pace_file"' EXIT
echo 0 >"$pace_file"
curl() {
  local n
  n=$(($(cat "$pace_file") + 1))
  echo "$n" >"$pace_file"
  if ((n % 8 == 0)); then sleep 3; fi
  command curl "$@"
}

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
  booking_settings ads ad_versions ad_variants ad_requests ad_events; do
  expect_code "anon cannot select $table" 42501 "$(curl -s "$rest/$table?select=*" "${headers[@]}")"
done
expect_code "anon cannot update enquiries" 42501 \
  "$(curl -s -X PATCH "$rest/enquiries?id=not.is.null" "${headers[@]}" -d '{"status":"contacted"}')"
expect_code "anon cannot insert enquiries" 42501 \
  "$(curl -s -X POST "$rest/enquiries" "${headers[@]}" -d '{"reference":"Q3-AAAAAA"}')"
expect_code "anon cannot change status" 42501 \
  "$(curl -s -X POST "$rest/rpc/set_enquiry_status" "${headers[@]}" \
    -d '{"p_enquiry_id":"00000000-0000-4000-8000-000000000000","p_status":"contacted"}')"
expect_code "anon cannot call the unlimited submit_enquiry" 42501 \
  "$(curl -s -X POST "$rest/rpc/submit_enquiry" "${headers[@]}" \
    -d '{"p_idempotency_key":"00000000-0000-4000-8000-000000000000","p_form_id":"enquiry","p_form_version":1,"p_answers":{}}')"
# An invalid submission fails validation and rolls back, so it leaves no rate-limit row.
expect_code "submit_enquiry_with_access validates on the server" 22023 \
  "$(curl -s -X POST "$rest/rpc/submit_enquiry_with_access" "${headers[@]}" \
    -d '{"p_idempotency_key":"00000000-0000-4000-8000-000000000000","p_form_id":"enquiry","p_form_version":1,"p_answers":{}}')"
expect_code "anon cannot run the funnel report" 42501 \
  "$(curl -s -X POST "$rest/rpc/funnel_report" "${headers[@]}" -d '{"p_from":"2026-01-01","p_to":"2026-12-31"}')"
expect_code "anon cannot resolve tokens directly" 42501 \
  "$(curl -s -X POST "$rest/rpc/resolve_enquiry_token" "${headers[@]}" -d '{"p_token":"x"}')"

# Ad review: every write path refuses anon (each with its exact arguments).
ad_rpc() {
  expect_code "anon cannot call $1" 42501 "$(curl -s -X POST "$rest/rpc/$1" "${headers[@]}" -d "$2")"
}
ad_rpc request_ad_change '{"p_ad_id":"00000000-0000-4000-8000-000000000000","p_body":"Make it bigger","p_size":"both"}'
ad_rpc withdraw_ad_request '{"p_request_id":"00000000-0000-4000-8000-000000000000"}'
ad_rpc approve_ad '{"p_ad_id":"00000000-0000-4000-8000-000000000000","p_version":1,"p_despite_open":true}'
ad_rpc archive_ad '{"p_ad_id":"00000000-0000-4000-8000-000000000000","p_archived":true}'
ad_rpc record_ad_version '{"p_version_id":"00000000-0000-4000-8000-000000000000","p_request_ids":[],"p_actor":"anon"}'
# Ad files: the bucket is private (no public URL) and anon lists nothing.
ad_public="$(curl -s -o /dev/null -w '%{http_code}' "$url/storage/v1/object/public/ads/x.png")"
if [[ "$ad_public" == 400 || "$ad_public" == 404 ]]; then echo "ok    the ads bucket has no public URLs ($ad_public)"; else echo "FAIL  public ad URL answered $ad_public"; fail=1; fi
ad_list="$(curl -s -X POST "$url/storage/v1/object/list/ads" "${headers[@]}" -d '{"prefix":""}')"
if [[ "$ad_list" == "[]" || "$ad_list" == *'"statusCode"'* || "$ad_list" == *'"error"'* ]]; then echo "ok    anon lists no ad files"; else echo "FAIL  anon listed ad files: ${ad_list:0:120}"; fail=1; fi
ad_get="$(curl -s -o /dev/null -w '%{http_code}' "$url/storage/v1/object/ads/x.png" "${headers[@]}")"
if [[ "$ad_get" != 200 ]]; then echo "ok    anon cannot read an ad file ($ad_get)"; else echo "FAIL  anon read an ad file"; fail=1; fi

# Edge Functions (slice 2).
functions="$url/functions/v1"
check() { # what, expected, actual
  if [[ "$3" == "$2" ]]; then echo "ok    $1"; else echo "FAIL  $1: got $3"; fail=1; fi
}
check "public-booking refuses an unknown token" '{"error":"invalid_token"}' \
  "$(curl -s -X POST "$functions/public-booking" "${headers[@]}" \
    -d '{"action":"context","token":"not-a-real-token-0000000000"}')"
check "public-booking refuses a details change without a valid token" '{"error":"invalid_token"}' \
  "$(curl -s -X POST "$functions/public-booking" "${headers[@]}" \
    -d '{"action":"update_details","token":"not-a-real-token-0000000000","details":{"phone":"0871234567"}}')"
types="$(curl -s -X POST "$rest/rpc/public_appointment_types" "${headers[@]}" -d '{}')"
if [[ "$types" == "["*"duration_minutes"* && "$types" != *what_to_prepare* && "$types" != *buffer* ]]; then
  echo "ok    anon reads only the appointment lengths"
else
  echo "FAIL  public_appointment_types: ${types:0:160}"
  fail=1
fi
check "booking-worker refuses a call without the worker secret" '{"error":"forbidden"}' \
  "$(curl -s -X POST "$functions/booking-worker" "${headers[@]}" -d '{}')"
check "calendar-admin refuses a caller who is not staff" '{"error":"forbidden"}' \
  "$(curl -s -X POST "$functions/calendar-admin" "${headers[@]}" -d '{"action":"start"}')"
check "staff-booking refuses a caller who is not staff" '{"error":"forbidden"}' \
  "$(curl -s -X POST "$functions/staff-booking" "${headers[@]}" \
    -d '{"action":"cancel","bookingId":"00000000-0000-4000-8000-000000000000"}')"
check "staff-accounts refuses admin actions from anon" '{"error":"forbidden"}' \
  "$(curl -s -X POST "$functions/staff-accounts" "${headers[@]}" \
    -d '{"action":"add","name":"X","email":"x@example.invalid","role":"admin"}')"
check "staff-accounts refuses a password change from anon" '{"error":"forbidden"}' \
  "$(curl -s -X POST "$functions/staff-accounts" "${headers[@]}" \
    -d '{"action":"set_password","password":"aaaaaaaaaaaaaaaa"}')"
check "forgot password validates the address" '{"error":"invalid_email"}' \
  "$(curl -s -X POST "$functions/staff-accounts" "${headers[@]}" -d '{"action":"forgot","email":"nope"}')"
check "the OAuth callback is reachable without a JWT and refuses a bad state" \
  "https://staff.q3interiors.ie/#/settings?calendar=error&reason=expired" \
  "$(curl -s -o /dev/null -w '%{redirect_url}' "$functions/google-oauth-callback?state=bad&code=x")"
exit "$fail"
