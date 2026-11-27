-- Estimates after a site visit (send_estimate, private.request_quote, the range rule). One
-- transaction, always rolled back.
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
create function pg_temp.as_user(p_id text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated')::text, true)
$$;
grant execute on all functions in schema pg_temp to anon, authenticated;
create temp table r (name text primary key, value jsonb);
grant all on r to anon, authenticated, service_role;
update public.booking_settings set enquiry_limit_per_hour = 100;

create function pg_temp.enquiry(p_key text, p_email text) returns uuid language plpgsql as $$
declare v jsonb;
begin
  v := public.submit_enquiry_with_access(p_key::uuid, 'enquiry', 2,
    jsonb_build_object('appointment_preference', 'on_site', 'project_type', 'kitchen',
      'location', 'Dublin 8', 'name', 'Test Person', 'email', p_email, 'phone', '087 123 4567',
      'site_street', '1 Test Street'));
  return (select id from public.enquiries where reference = v ->> 'reference');
end;
$$;
create function pg_temp.id(p text) returns uuid language sql as $$
  select (value #>> '{}')::uuid from r where name = p
$$;

insert into auth.users (id, aud, role, email) values
  ('00000000-0000-4000-8000-000000000eb1', 'authenticated', 'authenticated', 'staffe@example.invalid'),
  ('00000000-0000-4000-8000-000000000eb2', 'authenticated', 'authenticated', 'offe@example.invalid'),
  ('00000000-0000-4000-8000-000000000eb3', 'authenticated', 'authenticated', 'outsidere@example.invalid');
select private.add_staff('00000000-0000-4000-8000-000000000eb1', 'staffe@example.invalid', 'Staff E', 'staff');
select private.add_staff('00000000-0000-4000-8000-000000000eb2', 'offe@example.invalid', 'Off E', 'staff');
select private.set_staff_active('00000000-0000-4000-8000-000000000eb2', false);

insert into r values
  ('a', to_jsonb(pg_temp.enquiry('00000000-0000-4000-8000-000000000ea1', 'estimate@example.invalid'))),
  ('b', to_jsonb(pg_temp.enquiry('00000000-0000-4000-8000-000000000ea2', 'other@example.invalid')));

-- A confirmed site visit and a confirmed call, far in the future so nothing overlaps.
create function pg_temp.booking(p_name text, p_enquiry uuid, p_type text, p_state public.booking_state, p_day text)
returns void language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  insert into public.bookings (id, enquiry_id, staff_user_id, appointment_type_id, starts_at, ends_at,
    blocked, state, idempotency_key, calendar_event_id)
  values (v, p_enquiry, '00000000-0000-4000-8000-000000000eb1', p_type,
    (p_day || ' 10:00+00')::timestamptz, (p_day || ' 11:00+00')::timestamptz,
    tstzrange((p_day || ' 10:00+00')::timestamptz, (p_day || ' 11:00+00')::timestamptz),
    p_state, gen_random_uuid(), 'q3' || replace(v::text, '-', ''));
  insert into r values (p_name, to_jsonb(v));
end;
$$;
insert into r values ('caveats', to_jsonb(private.estimate_caveats_default()));
delete from public.message_blocks where key = 'estimate_caveats';
select pg_temp.booking('visit', pg_temp.id('a'), 'site_visit', 'confirmed', '2099-01-05');
select pg_temp.booking('call', pg_temp.id('b'), 'phone_consultation', 'confirmed', '2099-01-06');

-- The range rule: the same cases as estimateRange in supabase/functions/_shared/estimate.test.ts.
select pg_temp.expect((select bool_and((private.estimate_range(p, pc)).low = l and (private.estimate_range(p, pc)).high = h)
  from (values (100, 5.0, 95, 105), (10000, 5.0, 9500, 10500), (999, 10.0, 900, 1100),
               (1000, 10.0, 900, 1100), (12345, 7.5, 11400, 13250), (870, 0.5, 865, 875),
               (9999, 30.0, 7000, 13000), (250, 0.0, 250, 250), (1000, 2.5, 1000, 1050),
               (990, 2.5, 965, 1015)) v(p, pc, l, h)),
  'range rule matches the TypeScript cases');

-- Access: anon has no table and no function; the anon function list is unchanged (five).
select pg_temp.expect(
  (select array_agg(p.proname::text order by p.proname)
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'private') and has_function_privilege('anon', p.oid, 'execute'))
  = array['public_appointment_types', 'public_business_details', 'public_wording',
          'record_visit', 'submit_enquiry_with_access'],
  'anon may run only the five public functions');
set local role anon;
select pg_temp.expect_error('select * from public.estimates', '42501');
select pg_temp.expect_error(format('select public.send_estimate(%L, 1000, 10, ''Kitchen'')', pg_temp.id('visit')), '42501');
select pg_temp.expect_error(format('select private.request_quote(%L, %L)', pg_temp.id('a'), pg_temp.id('a')), '42501');
reset role;

set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-000000000eb3');
select pg_temp.expect_error(format('select public.send_estimate(%L, 1000, 10, ''Kitchen'')', pg_temp.id('visit')), '42501');
select pg_temp.as_user('00000000-0000-4000-8000-000000000eb2');
select pg_temp.expect_error(format('select public.send_estimate(%L, 1000, 10, ''Kitchen'')', pg_temp.id('visit')), '42501');

-- Validation: price, percent steps, the work, site visits only.
select pg_temp.as_user('00000000-0000-4000-8000-000000000eb1');
select pg_temp.expect_error(format('select public.send_estimate(%L, 99, 10, ''Kitchen'')', pg_temp.id('visit')), '22023');
select pg_temp.expect_error(format('select public.send_estimate(%L, 1000, 10.25, ''Kitchen'')', pg_temp.id('visit')), '22023');
select pg_temp.expect_error(format('select public.send_estimate(%L, 1000, 30.5, ''Kitchen'')', pg_temp.id('visit')), '22023');
select pg_temp.expect_error(format('select public.send_estimate(%L, 1000, 10, ''  '')', pg_temp.id('visit')), '22023');
select pg_temp.expect_error(format('select public.send_estimate(%L, 1000, 10, %L)', pg_temp.id('visit'), repeat('x', 601)), '22023');
select pg_temp.expect_error(format('select public.send_estimate(%L, 1000, 10, ''A call'')', pg_temp.id('call')), '22023');
select pg_temp.expect_error('select public.send_estimate(''00000000-0000-4000-8000-00000000dead'', 1000, 10, ''Kitchen'')', 'P0002');
-- Staff cannot write the table directly.
select pg_temp.expect_error(format('insert into public.estimates (enquiry_id, price_eur, plus_minus_percent, low_eur, high_eur, work_looked_at, caveats, valid_until) values (%L, 1000, 10, 900, 1100, ''x x'', ''c'', now())', pg_temp.id('a')), '42501');
select pg_temp.expect_error('update public.estimates set quote_requested_at = now()', '42501');

-- Send: the row, the computed range, the caveats as sent, valid 10 days, the email, the history.
insert into r values ('e1', to_jsonb(public.send_estimate(pg_temp.id('visit'), 10000, 5, '  Kitchen: strip out, new units.  ')));
select pg_temp.expect((select low_eur = 9500 and high_eur = 10500 and price_eur = 10000
    and plus_minus_percent = 5 and work_looked_at = 'Kitchen: strip out, new units.'
    and caveats = (select value #>> '{}' from r where name = 'caveats')
    and valid_until = sent_at + interval '10 days' and quote_requested_at is null
    and created_by_name = 'Staff E' and booking_id = pg_temp.id('visit')
  from public.estimates where id = pg_temp.id('e1')), 'estimate saved as sent');
select pg_temp.expect((select count(*) = 1 from public.communications
  where estimate_id = pg_temp.id('e1') and template = 'estimate'
    and recipient = 'estimate@example.invalid' and dedupe_key = 'estimate:' || pg_temp.id('e1')),
  'estimate email queued to the customer');
select pg_temp.expect((select detail = '€9,500 to €10,500 (price €10,000, plus or minus 5%)'
  from public.enquiry_events where enquiry_id = pg_temp.id('a') and kind = 'estimate_sent'),
  'history line');
-- Staff read it; an updated estimate is a second row (the newest is the current one).
select pg_temp.expect((select count(*) = 1 from public.estimates), 'staff read estimates');
reset role;
-- A reworded caveats block is what the next estimate carries.
insert into public.message_blocks (key, body) values ('estimate_caveats', 'Reworded caveats.')
  on conflict (key) do update set body = excluded.body;
set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-000000000eb1');
insert into r values ('e2', to_jsonb(public.send_estimate(pg_temp.id('visit'), 870, 0.5, 'Bathroom tiling')));
select pg_temp.expect((select low_eur = 865 and high_eur = 875 and caveats = 'Reworded caveats.'
  from public.estimates where id = pg_temp.id('e2')), 'second estimate, reworded caveats');
select pg_temp.expect((select caveats = (select value #>> '{}' from r where name = 'caveats')
  from public.estimates where id = pg_temp.id('e1')), 'the first keeps the caveats it was sent with');
select pg_temp.as_user('00000000-0000-4000-8000-000000000eb2');
select pg_temp.expect((select count(*) = 0 from public.estimates), 'deactivated staff read none');
reset role;

-- "Get my quote": once per estimate, its own enquiry only, staff alerted once.
select pg_temp.expect(private.request_quote(pg_temp.id('b'), pg_temp.id('e1')) = 'not_found', 'other enquiry');
select pg_temp.expect(private.request_quote(pg_temp.id('a'), pg_temp.id('e1')) = 'requested', 'first yes');
insert into r values ('at', to_jsonb((select quote_requested_at from public.estimates where id = pg_temp.id('e1'))));
select pg_temp.expect(private.request_quote(pg_temp.id('a'), pg_temp.id('e1')) = 'already', 'repeat');
select pg_temp.expect((select quote_requested_at = (select (value #>> '{}')::timestamptz from r where name = 'at')
  from public.estimates where id = pg_temp.id('e1')), 'repeat keeps the first time');
select pg_temp.expect((select count(*) >= 1 and count(*) = count(distinct recipient)
  from public.communications where estimate_id = pg_temp.id('e1') and template = 'staff_quote_request'),
  'one alert per active staff member');
select pg_temp.expect((select count(*) = 0 from public.communications c
  where c.estimate_id = pg_temp.id('e1') and c.template = 'staff_quote_request'
    and c.recipient = 'offe@example.invalid'), 'no alert to deactivated staff');
select pg_temp.expect((select count(*) = 1 from public.enquiry_events
  where enquiry_id = pg_temp.id('a') and kind = 'quote_requested'), 'one history line for the yes');

-- Deleting the enquiry takes its estimates and their emails with it.
delete from public.enquiries where id = pg_temp.id('a');
select pg_temp.expect((select count(*) = 0 from public.estimates where id in (pg_temp.id('e1'), pg_temp.id('e2'))), 'cascade');

rollback;
