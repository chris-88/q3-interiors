-- Slice 2 checks against the real database, in one transaction that is always rolled back.
-- Run with `npm run test:db`. Requires one bookable staff member (staff_availability row).
begin;

create function pg_temp.expect_error(p_sql text, p_code text) returns void
language plpgsql as $$
begin
  execute p_sql;
  raise exception 'expected error % from: %', p_code, p_sql;
exception when others then
  if sqlstate <> p_code then
    raise exception 'expected error % but got % (%) from: %', p_code, sqlstate, sqlerrm, p_sql;
  end if;
end;
$$;

create function pg_temp.expect(p_ok boolean, p_what text) returns void
language plpgsql as $$
begin
  if not coalesce(p_ok, false) then
    raise exception 'expectation failed: %', p_what;
  end if;
end;
$$;

create temp table r (name text primary key, value jsonb);
grant all on r to anon, authenticated, service_role;

create function pg_temp.answers(p_email text) returns jsonb language sql as $$
  select jsonb_build_object(
    'project_type', 'kitchen', 'description', 'Replace the kitchen units and worktops.',
    'location', 'D07 X2Y3', 'timing', 'flexible', 'name', 'Test Person',
    'email', p_email, 'phone', '087 123 4567')
$$;

-- A slot well inside the horizon and past the notice period: 10:00 Dublin, 10 days out.
create function pg_temp.slot(p_days integer, p_hour integer) returns timestamptz language sql as $$
  select ((current_date + p_days)::timestamp + make_interval(hours => p_hour)) at time zone 'Europe/Dublin'
$$;

select pg_temp.expect(public.bookable_staff() is not null, 'a bookable staff member exists');

-- -------------------------------------------------------------------------------------------
-- anon: submission with access token; nothing else
-- -------------------------------------------------------------------------------------------
set local role anon;
insert into r values ('a', public.submit_enquiry_with_access(
  '00000000-0000-4000-8000-0000000000b1', 'enquiry', 1, pg_temp.answers('a@example.invalid')));
insert into r values ('a_retry', public.submit_enquiry_with_access(
  '00000000-0000-4000-8000-0000000000b1', 'enquiry', 1, pg_temp.answers('a@example.invalid')));
insert into r values ('b', public.submit_enquiry_with_access(
  '00000000-0000-4000-8000-0000000000b2', 'enquiry', 1, pg_temp.answers('b@example.invalid')));
-- The slice 1 function still works for older clients.
select pg_temp.expect(public.submit_enquiry(
  '00000000-0000-4000-8000-0000000000b3', 'enquiry', 1, pg_temp.answers('c@example.invalid')) ~ '^Q3-',
  'submit_enquiry still returns a reference');

select pg_temp.expect_error('select * from public.bookings', '42501');
select pg_temp.expect_error('select * from public.appointment_types', '42501');
select pg_temp.expect_error('select * from public.staff_availability', '42501');
select pg_temp.expect_error('select * from public.calendar_connections', '42501');
select pg_temp.expect_error('select * from public.integration_jobs', '42501');
select pg_temp.expect_error('select * from public.communications', '42501');
select pg_temp.expect_error('select * from private.calendar_tokens', '42501');
select pg_temp.expect_error('select * from private.enquiry_access_tokens', '42501');
select pg_temp.expect_error('select public.resolve_enquiry_token(''x'')', '42501');
select pg_temp.expect_error(
  'select private.reserve_booking(gen_random_uuid(), ''phone_consultation'', now(), gen_random_uuid())', '42501');
reset role;

select pg_temp.expect((select value ->> 'reference' from r where name = 'a')
  = (select value ->> 'reference' from r where name = 'a_retry'), 'retry returns the same reference');
select pg_temp.expect((select value ->> 'access_token' from r where name = 'a')
  <> (select value ->> 'access_token' from r where name = 'a_retry'), 'retry mints a fresh token');
select pg_temp.expect(
  (select count(*) from public.enquiries where idempotency_key = '00000000-0000-4000-8000-0000000000b1') = 1,
  'one enquiry for a repeated key');
select pg_temp.expect(length((select value ->> 'access_token' from r where name = 'a')) >= 43,
  'token carries 256 bits');
select pg_temp.expect(not exists (
  select 1 from private.enquiry_access_tokens t, r
  where r.name = 'a' and t.token_hash = r.value ->> 'access_token'), 'tokens are not stored in clear');

insert into r select 'a_id', to_jsonb(id) from public.enquiries where idempotency_key = '00000000-0000-4000-8000-0000000000b1';
insert into r select 'b_id', to_jsonb(id) from public.enquiries where idempotency_key = '00000000-0000-4000-8000-0000000000b2';

-- -------------------------------------------------------------------------------------------
-- Token scoping
-- -------------------------------------------------------------------------------------------
set local role service_role;
select pg_temp.expect(public.resolve_enquiry_token((select value ->> 'access_token' from r where name = 'a'))
  = (select (value #>> '{}')::uuid from r where name = 'a_id'), 'token A resolves to enquiry A');
select pg_temp.expect(public.resolve_enquiry_token((select value ->> 'access_token' from r where name = 'a_retry'))
  = (select (value #>> '{}')::uuid from r where name = 'a_id'), 'the retry token also resolves to A');
select pg_temp.expect(public.resolve_enquiry_token((select value ->> 'access_token' from r where name = 'b'))
  <> (select (value #>> '{}')::uuid from r where name = 'a_id'), 'token B does not resolve to A');
select pg_temp.expect(public.resolve_enquiry_token('not-a-token') is null, 'unknown token refused');
select pg_temp.expect(public.resolve_enquiry_token(null) is null, 'null token refused');
reset role;
update private.enquiry_access_tokens set expires_at = now() - interval '1 second'
where token_hash = private.hash_token((select value ->> 'access_token' from r where name = 'b'));
set local role service_role;
select pg_temp.expect(public.resolve_enquiry_token((select value ->> 'access_token' from r where name = 'b')) is null,
  'expired token refused');

-- -------------------------------------------------------------------------------------------
-- Eligibility and site details
-- -------------------------------------------------------------------------------------------
select pg_temp.expect(public.enquiry_booking_eligibility((select (value #>> '{}')::uuid from r where name = 'a_id'),
  'phone_consultation') = 'eligible', 'phone consultation eligible');
select pg_temp.expect(public.enquiry_booking_eligibility((select (value #>> '{}')::uuid from r where name = 'a_id'),
  'site_visit') = 'site_address_required', 'site visit needs an address first');
select pg_temp.expect_error(format('select private.save_site_details(%L, %L)',
  (select value #>> '{}' from r where name = 'a_id'), '{"site_address": "x"}'), '22023');
select private.save_site_details((select (value #>> '{}')::uuid from r where name = 'a_id'),
  '{"site_address": "12 Example Road, Dublin 7", "access_notes": "Side gate"}');
select pg_temp.expect(public.enquiry_booking_eligibility((select (value #>> '{}')::uuid from r where name = 'a_id'),
  'site_visit') = 'eligible', 'site visit eligible after the address');
select pg_temp.expect((select count(*) from public.enquiry_revisions
  where enquiry_id = (select (value #>> '{}')::uuid from r where name = 'a_id') and form_id = 'site_details') = 1,
  'site details stored as a revision');

-- -------------------------------------------------------------------------------------------
-- Reservation: idempotency, exclusion with buffers, one live booking per enquiry, daily limit
-- -------------------------------------------------------------------------------------------
insert into r values ('res1', private.reserve_booking(
  (select (value #>> '{}')::uuid from r where name = 'a_id'), 'site_visit', pg_temp.slot(10, 10),
  '00000000-0000-4000-8000-0000000000c1'));
select pg_temp.expect((select value ->> 'status' from r where name = 'res1') = 'reserved', 'first reserve wins');
insert into r values ('res1_again', private.reserve_booking(
  (select (value #>> '{}')::uuid from r where name = 'a_id'), 'site_visit', pg_temp.slot(10, 10),
  '00000000-0000-4000-8000-0000000000c1'));
select pg_temp.expect((select value ->> 'status' from r where name = 'res1_again') = 'existing'
  and (select value ->> 'booking_id' from r where name = 'res1_again') = (select value ->> 'booking_id' from r where name = 'res1'),
  'same key returns the same booking');
select pg_temp.expect((select count(*) from public.integration_jobs
  where booking_id = (select (value ->> 'booking_id')::uuid from r where name = 'res1')) = 1, 'one calendar job');

-- Enquiry B (token expired, but reservation is a server call) tries an overlapping time:
-- 11:15 overlaps the visit's 30-minute after-buffer (10:00-11:00 + 30).
insert into r values ('res_b', private.reserve_booking(
  (select (value #>> '{}')::uuid from r where name = 'b_id'), 'phone_consultation', pg_temp.slot(10, 11) + interval '15 minutes',
  '00000000-0000-4000-8000-0000000000c2'));
select pg_temp.expect((select value ->> 'status' from r where name = 'res_b') = 'slot_unavailable'
  and (select value ->> 'reason' from r where name = 'res_b') = 'taken', 'overlap with buffer refused');
insert into r values ('res_b2', private.reserve_booking(
  (select (value #>> '{}')::uuid from r where name = 'b_id'), 'phone_consultation', pg_temp.slot(10, 11) + interval '30 minutes',
  '00000000-0000-4000-8000-0000000000c3'));
select pg_temp.expect((select value ->> 'status' from r where name = 'res_b2') = 'reserved', 'adjacent slot allowed');

insert into r values ('res_a2', private.reserve_booking(
  (select (value #>> '{}')::uuid from r where name = 'a_id'), 'phone_consultation', pg_temp.slot(11, 10),
  '00000000-0000-4000-8000-0000000000c4'));
select pg_temp.expect((select value ->> 'status' from r where name = 'res_a2') = 'already_booked',
  'one live booking per enquiry');

insert into r values ('res_notice', private.reserve_booking(
  (select (value #>> '{}')::uuid from r where name = 'b_id'), 'phone_consultation', now() + interval '1 hour',
  '00000000-0000-4000-8000-0000000000c5'));
select pg_temp.expect((select value ->> 'reason' from r where name = 'res_notice') = 'notice', 'minimum notice enforced');

-- -------------------------------------------------------------------------------------------
-- Calendar job transitions: retry, complete twice (one email), failure releases the slot
-- -------------------------------------------------------------------------------------------
insert into r select 'job1', to_jsonb(id) from public.integration_jobs
where booking_id = (select (value ->> 'booking_id')::uuid from r where name = 'res1');
select private.calendar_job_started((select (value #>> '{}')::bigint from r where name = 'job1'));
select pg_temp.expect((select state = 'calendar_pending' from public.bookings
  where id = (select (value ->> 'booking_id')::uuid from r where name = 'res1')), 'pending once started');
select private.retry_calendar_job((select (value #>> '{}')::bigint from r where name = 'job1'), 'timeout', true, 60);
select pg_temp.expect((select outcome_unknown and state = 'queued' from public.integration_jobs
  where id = (select (value #>> '{}')::bigint from r where name = 'job1')), 'timeout recorded as unknown outcome');
select private.complete_calendar_job((select (value #>> '{}')::bigint from r where name = 'job1'), 'https://calendar.example/e');
select private.complete_calendar_job((select (value #>> '{}')::bigint from r where name = 'job1'), 'https://calendar.example/e');
select pg_temp.expect((select state = 'confirmed' from public.bookings
  where id = (select (value ->> 'booking_id')::uuid from r where name = 'res1')), 'confirmed');
select pg_temp.expect((select count(*) from public.communications
  where booking_id = (select (value ->> 'booking_id')::uuid from r where name = 'res1')) = 1, 'exactly one email queued');

insert into r select 'job_b2', to_jsonb(id) from public.integration_jobs
where booking_id = (select (value ->> 'booking_id')::uuid from r where name = 'res_b2');
select private.fail_calendar_job((select (value #>> '{}')::bigint from r where name = 'job_b2'), 'Google said 403', false);
select pg_temp.expect((select state = 'failed' from public.bookings
  where id = (select (value ->> 'booking_id')::uuid from r where name = 'res_b2')), 'failed');
insert into r values ('res_b3', private.reserve_booking(
  (select (value #>> '{}')::uuid from r where name = 'b_id'), 'phone_consultation', pg_temp.slot(10, 11) + interval '30 minutes',
  '00000000-0000-4000-8000-0000000000c6'));
select pg_temp.expect((select value ->> 'status' from r where name = 'res_b3') = 'reserved',
  'a failed booking releases its slot and the enquiry may book again');

-- Email: sent twice records once.
select private.communication_sent((select id from public.communications
  where booking_id = (select (value ->> 'booking_id')::uuid from r where name = 'res1')), 'msg_1');
select private.communication_sent((select id from public.communications
  where booking_id = (select (value ->> 'booking_id')::uuid from r where name = 'res1')), 'msg_1');
select pg_temp.expect((select count(*) from public.enquiry_events
  where booking_id = (select (value ->> 'booking_id')::uuid from r where name = 'res1') and kind = 'email_sent') = 1,
  'one email_sent event');
reset role;

-- Daily visit limit: fill the day directly, then one more visit is refused.
update public.staff_availability set daily_visit_limit = 1 where staff_user_id = public.bookable_staff();
set local role service_role;
select private.save_site_details((select (value #>> '{}')::uuid from r where name = 'b_id'),
  '{"site_address": "1 Other Street, Dublin 9"}');
-- B's live phone booking is on day 10; cancel it out of the way by failing its job.
select private.fail_calendar_job((select id from public.integration_jobs
  where booking_id = (select (value ->> 'booking_id')::uuid from r where name = 'res_b3')), 'test', false);
insert into r values ('res_limit', private.reserve_booking(
  (select (value #>> '{}')::uuid from r where name = 'b_id'), 'site_visit', pg_temp.slot(10, 15),
  '00000000-0000-4000-8000-0000000000c7'));
select pg_temp.expect((select value ->> 'reason' from r where name = 'res_limit') = 'daily_limit', 'daily visit limit');
reset role;

-- -------------------------------------------------------------------------------------------
-- Signed-in users
-- -------------------------------------------------------------------------------------------
insert into auth.users (id, aud, role, email)
values ('00000000-0000-4000-8000-0000000000d1', 'authenticated', 'authenticated', 'outsider2@example.invalid');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000000d1", "role": "authenticated"}', true);
select pg_temp.expect((select count(*) from public.bookings) = 0, 'non-staff see no bookings');
select pg_temp.expect((select count(*) from public.calendar_connections) = 0, 'non-staff see no connections');
select pg_temp.expect_error('select * from private.calendar_tokens', '42501');
select pg_temp.expect_error('update public.bookings set state = ''confirmed''', '42501');

select set_config('request.jwt.claims', json_build_object('sub', public.bookable_staff(), 'role', 'authenticated')::text, true);
select pg_temp.expect((select count(*) from public.bookings) >= 3, 'staff see bookings');
update public.staff_availability set horizon_days = 28 where staff_user_id = public.bookable_staff();
select pg_temp.expect((select horizon_days = 28 from public.staff_availability where staff_user_id = public.bookable_staff()),
  'staff edit availability');
select pg_temp.expect_error('update public.bookings set state = ''confirmed''', '42501');
select pg_temp.expect_error('update public.staff_availability set staff_user_id = gen_random_uuid()', '42501');
select pg_temp.expect_error('select * from private.calendar_tokens', '42501');
reset role;

select 'booking checks passed';
rollback;
