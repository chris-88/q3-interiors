#!/usr/bin/env bash
# A real two-session race for one slot against the live database. Two enquiries (reserved test
# addresses) try to reserve the same time from two concurrent transactions: exactly one must
# win. Everything it creates is deleted at the end, pass or fail.
set -euo pipefail
DB_URL="${DATABASE_URL:-$(pass show env/q3-interiors/DATABASE_URL)}"
PSQL=(psql "$DB_URL" -X -q -At -v ON_ERROR_STOP=1)
tag="race-$(date +%s)-$$"
answers() {
  printf '{"project_type":"kitchen","description":"Race test, delete me.","location":"D07","timing":"flexible","name":"Race Test","email":"%s@example.invalid","phone":"087 000 0000"}' "$1"
}

# Each submission comes from this test's own pretend address, so the race never uses up a real
# or shared rate-limit bucket; its limiter rows are removed at the end.
submit() {
  "${PSQL[@]}" -c "select (public.submit_enquiry_with_access(gen_random_uuid(), 'enquiry', 1, '$(answers "$1")'::jsonb))->>'reference'
    from (select set_config('request.headers', '{\"cf-connecting-ip\": \"$tag\"}', false)) s"
}
a=$(submit "$tag-a")
b=$(submit "$tag-b")
cleanup() {
  "${PSQL[@]}" -c "delete from public.enquiries where reference in ('$a', '$b')" >/dev/null
  "${PSQL[@]}" -c "delete from private.rate_limit_hits where addr_hash = private.address_hash('$tag')" >/dev/null
}
trap cleanup EXIT

slot="((current_date + 12)::timestamp + interval '10 hours') at time zone 'Europe/Dublin'"
reserve() { # $1 reference, $2 delay before commit
  "${PSQL[@]}" <<SQL
begin;
select private.reserve_booking((select id from public.enquiries where reference = '$1'),
  'phone_consultation', $slot, gen_random_uuid()) ->> 'status';
select pg_sleep($2);
commit;
SQL
}

out_a=$(mktemp); out_b=$(mktemp)
reserve "$a" 2 >"$out_a" &
sleep 0.5
reserve "$b" 0 >"$out_b" &
wait

ra=$(head -1 "$out_a"); rb=$(head -1 "$out_b"); rm -f "$out_a" "$out_b"
live=$("${PSQL[@]}" -c "select count(*) from public.bookings b join public.enquiries e on e.id = b.enquiry_id
  where e.reference in ('$a', '$b') and b.state in ('reserved', 'calendar_pending', 'confirmed')")
echo "first: $ra, second: $rb, live bookings: $live"
[[ "$ra" == reserved && "$rb" == slot_unavailable && "$live" == 1 ]] || { echo "race check FAILED"; exit 1; }
echo "race check passed"
