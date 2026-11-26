-- Slice 4 part A checks against the real database, in one transaction that is always rolled back.
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

create function pg_temp.answers(p_name text) returns jsonb language sql as $$
  select jsonb_build_object(
    'project_type', 'kitchen', 'description', 'Slice 4 test, rolled back.', 'location', 'D07',
    'timing', 'flexible', 'name', p_name, 'email', lower(p_name) || '@example.invalid', 'phone', '087 000 0000')
$$;
create function pg_temp.key(p_n integer) returns uuid language sql as $$
  select ('00000000-0000-4000-8000-' || lpad(p_n::text, 12, '0'))::uuid
$$;
-- Pretend to be a request from an address (as PostgREST sets request.headers).
create function pg_temp.from_address(p_address text) returns void language sql as $$
  select set_config('request.headers', json_build_object('cf-connecting-ip', p_address)::text, true)
$$;
create function pg_temp.submit(p_key integer, p_name text, p_trap text default null) returns jsonb language sql as $$
  select public.submit_enquiry_with_access(pg_temp.key(p_key), 'enquiry', 1, pg_temp.answers(p_name),
    false, null, p_trap)
$$;
grant execute on all functions in schema pg_temp to anon;

-- -------------------------------------------------------------------------------------------
-- Address resolution and hashing
-- -------------------------------------------------------------------------------------------
select set_config('request.headers', '{"cf-connecting-ip": "203.0.113.9", "x-forwarded-for": "198.51.100.1"}', true);
select pg_temp.expect(private.request_address() = '203.0.113.9', 'cf-connecting-ip wins');
select set_config('request.headers', '{"x-forwarded-for": "198.51.100.1, 10.0.0.1"}', true);
select pg_temp.expect(private.request_address() = '198.51.100.1', 'first x-forwarded-for hop');
select set_config('request.headers', '', true);
select pg_temp.expect(private.request_address() = 'shared', 'no header: one shared bucket');
select pg_temp.expect(private.address_hash('203.0.113.9') ~ '^[0-9a-f]{64}$'
  and private.address_hash('203.0.113.9') = private.address_hash('203.0.113.9')
  and private.address_hash('203.0.113.9') <> private.address_hash('203.0.113.10'), 'keyed hash, stable');

-- -------------------------------------------------------------------------------------------
-- anon: the enquiry limit, honeypot, alerts; nothing else new is reachable
-- -------------------------------------------------------------------------------------------
set local role anon;
select pg_temp.expect_error('select * from public.deletion_log', '42501');
select pg_temp.expect_error('select public.delete_enquiry(gen_random_uuid(), ''x'')', '42501');
select pg_temp.expect_error('select public.retention_preview()', '42501');
select pg_temp.expect_error('select public.pending_event_deletion_count()', '42501');
select pg_temp.expect_error('select * from private.rate_limit_hits', '42501');
select pg_temp.expect_error('select private.run_retention()', '42501');
select pg_temp.expect_error('select private.rate_limit_take(''enquiry'', ''x'', null, 5)', '42501');

select pg_temp.from_address('203.0.113.7');
insert into r values ('e1', pg_temp.submit(1, 'One'));
insert into r values ('e1_retry', pg_temp.submit(1, 'One'));
insert into r values ('e2', pg_temp.submit(2, 'Two'));
insert into r values ('e3', pg_temp.submit(3, 'Three'));
insert into r values ('trap', pg_temp.submit(4, 'Bot', 'http://spam.example'));
insert into r values ('e5', pg_temp.submit(5, 'Five'));
-- The sixth counted submission from the same address in an hour is refused...
select pg_temp.expect_error('select pg_temp.submit(6, ''Six'')', 'PT429');
-- ...but a retry of a saved one is not a new submission,
insert into r values ('e1_late_retry', pg_temp.submit(1, 'One'));
-- and another address has its own bucket.
select pg_temp.from_address('203.0.113.8');
insert into r values ('other', pg_temp.submit(7, 'Seven'));
-- No header at all: everyone shares one bucket rather than going unlimited.
select set_config('request.headers', '', true);
insert into r values ('shared', pg_temp.submit(8, 'Eight'));
reset role;

select pg_temp.expect((select value ->> 'reference' from r where name = 'e1')
  = (select value ->> 'reference' from r where name = 'e1_retry')
  and (select value ->> 'reference' from r where name = 'e1')
  = (select value ->> 'reference' from r where name = 'e1_late_retry'), 'retries keep the reference');
select pg_temp.expect((select count(*) from private.rate_limit_hits
  where addr_hash = private.address_hash('203.0.113.7') and bucket = 'enquiry') = 5,
  'five counted: retries of the same key never count twice');
select pg_temp.expect(not exists (select 1 from private.rate_limit_hits where addr_hash like '%203.0.113%'),
  'the address itself is never stored');
select pg_temp.expect((select count(*) from private.rate_limit_hits
  where addr_hash = private.address_hash('shared') and bucket = 'enquiry') >= 1, 'shared bucket used');

-- Honeypot: a normal-looking answer, nothing stored, no alert.
select pg_temp.expect((select value ->> 'reference' ~ '^Q3-[A-Z0-9]{6}$' and value -> 'access_token' = 'null'
  from r where name = 'trap'), 'trap looks like success');
select pg_temp.expect(not exists (select 1 from public.enquiries where idempotency_key = pg_temp.key(4)),
  'trap stores no enquiry');
select pg_temp.expect(not exists (select 1 from public.enquiries where reference = (select value ->> 'reference' from r where name = 'trap')),
  'trap reference is not a real enquiry');

-- Staff alert: one per enquiry per staff member, even after retries.
select pg_temp.expect((select count(*) from public.communications c join public.enquiries e on e.id = c.enquiry_id
  where e.idempotency_key = pg_temp.key(1) and c.template = 'staff_new_enquiry') = (select count(*) from public.staff where active),
  'one new-enquiry alert per staff member');
select pg_temp.expect(not exists (select 1 from public.communications where template = 'staff_new_enquiry'
  and dedupe_key like '%' || pg_temp.key(4)::text || '%'), 'no alert for a trap');
set local role service_role;
select private.request_contact((select id from public.enquiries where idempotency_key = pg_temp.key(2)), 'No suitable time');
select private.request_contact((select id from public.enquiries where idempotency_key = pg_temp.key(2)), 'Again');
reset role;
select pg_temp.expect((select count(*) from public.communications c join public.enquiries e on e.id = c.enquiry_id
  where e.idempotency_key = pg_temp.key(2) and c.template = 'staff_callback_request') = (select count(*) from public.staff where active),
  'one call-back alert per staff member');

-- Limiter rules directly: an idempotent retry is one row; purge keeps recent rows.
set local role service_role;
select pg_temp.expect(private.rate_limit_take('booking_write', 'h', 'k1', 2), 'first');
select pg_temp.expect(private.rate_limit_take('booking_write', 'h', 'k1', 2), 'same key again');
select pg_temp.expect(private.rate_limit_take('booking_write', 'h', 'k2', 2), 'second');
select pg_temp.expect(not private.rate_limit_take('booking_write', 'h', 'k3', 2), 'third refused');
select pg_temp.expect(private.rate_limit_take('booking_write', 'h', 'k1', 2), 'a counted key still passes');
reset role;
select pg_temp.expect((select count(*) from private.rate_limit_hits where addr_hash = 'h') = 2, 'two rows');
update private.rate_limit_hits set created_at = now() - interval '25 hours' where addr_hash = 'h' and idem_key = 'k1';
select private.purge_rate_limits();
select pg_temp.expect((select count(*) from private.rate_limit_hits where addr_hash = 'h') = 1, 'old rows purged');

-- -------------------------------------------------------------------------------------------
-- Retention: off by default; when on, deletes old non-won enquiries only
-- -------------------------------------------------------------------------------------------
update public.enquiries set submitted_at = now() - interval '13 months'
where idempotency_key in (pg_temp.key(1), pg_temp.key(2), pg_temp.key(3));
update public.enquiries set outcome = 'won', outcome_at = now(), won_date = current_date where idempotency_key = pg_temp.key(3);
-- Live may have retention set; test the off state explicitly (rolled back).
update public.booking_settings set retention_months = null;
select pg_temp.expect((select retention_months is null from public.booking_settings), 'retention can be off');
select pg_temp.expect(private.run_retention() = 0, 'off: deletes nothing');
select pg_temp.expect((select count(*) from public.enquiries where idempotency_key in (pg_temp.key(1), pg_temp.key(2), pg_temp.key(3))) = 3,
  'off: all kept');

-- A confirmed booking with an event on enquiry 1, so deletion must queue its Google removal.
set local role service_role;
select private.reserve_booking((select id from public.enquiries where idempotency_key = pg_temp.key(1)),
  'phone_consultation', ((current_date + 10)::timestamp + interval '10 hours') at time zone 'Europe/Dublin', gen_random_uuid());
select private.complete_calendar_job((select j.id from public.integration_jobs j join public.bookings b on b.id = j.booking_id
  join public.enquiries e on e.id = b.enquiry_id where e.idempotency_key = pg_temp.key(1)), null);
reset role;
insert into r select 'event1', to_jsonb(b.calendar_event_id) from public.bookings b join public.enquiries e on e.id = b.enquiry_id
where e.idempotency_key = pg_temp.key(1);

insert into auth.users (id, aud, role, email)
values ('00000000-0000-4000-8000-0000000000f1', 'authenticated', 'authenticated', 'outsider4@example.invalid');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000000f1", "role": "authenticated"}', true);
select pg_temp.expect_error('select public.retention_preview(12)', '42501');
select pg_temp.expect_error(format('select public.delete_enquiry(%L, ''x'')', (select id from public.enquiries where idempotency_key = pg_temp.key(5))), '42501');
select pg_temp.expect((select count(*) from public.deletion_log) = 0, 'non-staff see no deletion log');
update public.booking_settings set retention_months = 1; -- RLS: matches no row for non-staff
reset role;
select pg_temp.expect((select retention_months is null from public.booking_settings), 'non-staff cannot turn retention on');
set local role authenticated;

select set_config('request.jwt.claims', json_build_object('sub', public.bookable_staff(), 'role', 'authenticated')::text, true);
select pg_temp.expect(public.retention_preview() = 0, 'preview with retention off');
select pg_temp.expect(public.retention_preview(12) >= 2, 'preview of a proposed 12 months counts the old non-won ones');
update public.booking_settings set retention_months = 12;
reset role;

select pg_temp.expect(private.run_retention() >= 2, 'on: deletes old enquiries');
select pg_temp.expect(not exists (select 1 from public.enquiries where idempotency_key in (pg_temp.key(1), pg_temp.key(2))),
  'old non-won enquiries deleted');
select pg_temp.expect(exists (select 1 from public.enquiries where idempotency_key = pg_temp.key(3)), 'won enquiry kept');
select pg_temp.expect(exists (select 1 from public.enquiries where idempotency_key = pg_temp.key(5)), 'recent enquiry kept');
select pg_temp.expect(exists (select 1 from private.pending_event_deletions
  where calendar_event_id = (select value #>> '{}' from r where name = 'event1')), 'its Google event is queued for removal');
select pg_temp.expect((select count(*) from public.deletion_log where reason = 'retention'
  and reference = (select value ->> 'reference' from r where name = 'e1')) = 1, 'retention logged');
select pg_temp.expect(not exists (select 1 from public.communications c where c.dedupe_key like 'staff_new_enquiry:%'
  and c.enquiry_id not in (select id from public.enquiries)), 'queued messages went with them');

-- -------------------------------------------------------------------------------------------
-- Staff delete for a data request
-- -------------------------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', public.bookable_staff(), 'role', 'authenticated')::text, true);
select pg_temp.expect_error(format('select public.delete_enquiry(%L, ''Q3-WRONG1'')',
  (select id from public.enquiries where idempotency_key = pg_temp.key(5))), '22023');
insert into r values ('deleted', to_jsonb(public.delete_enquiry(
  (select id from public.enquiries where idempotency_key = pg_temp.key(5)),
  lower(' ' || (select value ->> 'reference' from r where name = 'e5') || ' '))));
select pg_temp.expect((select count(*) from public.deletion_log where reason = 'staff_request'
  and reference = (select value ->> 'reference' from r where name = 'e5') and deleted_by_name is not null) = 1,
  'staff deletion logged with who, no personal data');
reset role;
select pg_temp.expect(not exists (select 1 from public.enquiries where idempotency_key = pg_temp.key(5)), 'deleted');
select pg_temp.expect(not exists (select 1 from public.communications c where c.enquiry_id not in (select id from public.enquiries)),
  'no messages left for deleted enquiries');

select 'hardening checks passed';
rollback;
