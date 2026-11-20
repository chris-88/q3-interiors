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

for table in enquiries form_versions staff enquiry_revisions enquiry_attribution enquiry_events; do
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
exit "$fail"
