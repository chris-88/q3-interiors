-- Quotes: send_quote, numbering and versions, working days, the not-included list, change
-- requests. One transaction, always rolled back.
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
  ('00000000-0000-4000-8000-000000000db1', 'authenticated', 'authenticated', 'staffq@example.invalid'),
  ('00000000-0000-4000-8000-000000000db2', 'authenticated', 'authenticated', 'offq@example.invalid'),
  ('00000000-0000-4000-8000-000000000db3', 'authenticated', 'authenticated', 'outsiderq@example.invalid');
select private.add_staff('00000000-0000-4000-8000-000000000db1', 'staffq@example.invalid', 'Staff Q', 'staff');
select private.add_staff('00000000-0000-4000-8000-000000000db2', 'offq@example.invalid', 'Off Q', 'staff');
select private.set_staff_active('00000000-0000-4000-8000-000000000db2', false);

insert into r values
  ('a', to_jsonb(pg_temp.enquiry('00000000-0000-4000-8000-000000000da1', 'estimate@example.invalid'))),
  ('b', to_jsonb(pg_temp.enquiry('00000000-0000-4000-8000-000000000da2', 'other@example.invalid')));

-- A confirmed site visit and a confirmed call, far in the future so nothing overlaps.
create function pg_temp.booking(p_name text, p_enquiry uuid, p_type text, p_state public.booking_state, p_day text)
returns void language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  insert into public.bookings (id, enquiry_id, staff_user_id, appointment_type_id, starts_at, ends_at,
    blocked, state, idempotency_key, calendar_event_id)
  values (v, p_enquiry, '00000000-0000-4000-8000-000000000db1', p_type,
    (p_day || ' 10:00+00')::timestamptz, (p_day || ' 11:00+00')::timestamptz,
    tstzrange((p_day || ' 10:00+00')::timestamptz, (p_day || ' 11:00+00')::timestamptz),
    p_state, gen_random_uuid(), 'q3' || replace(v::text, '-', ''));
  insert into r values (p_name, to_jsonb(v));
end;
$$;

insert into r values ('c', to_jsonb(pg_temp.enquiry('00000000-0000-4000-8000-000000000da3', 'quotec@example.invalid')));
insert into r values ('n', to_jsonb(pg_temp.enquiry('00000000-0000-4000-8000-000000000da4', 'quoten@example.invalid')));
update public.enquiries set answers = answers - 'email' where id = pg_temp.id('n');

-- Working days: the same cases as addWorkingDays (working-days.test.ts). No public holidays yet.
select pg_temp.expect(private.add_working_days('2026-11-27', 3) = '2026-12-02', 'fri + 3');
select pg_temp.expect(private.add_working_days('2026-11-25', 3) = '2026-11-30', 'wed + 3');
select pg_temp.expect(private.add_working_days('2026-11-28', 3) = '2026-12-02', 'sat + 3');
select pg_temp.expect(private.add_working_days('2026-11-27', 15) = '2026-12-18', 'fri + 15');
select pg_temp.expect(private.add_working_days('2026-11-27', 0) = '2026-11-27', '+ 0');
select pg_temp.expect(private.long_date('2026-12-18') = 'Fri 18 Dec 2026', 'long date');

-- Access: anon nothing; the anon function list is unchanged (five).
select pg_temp.expect(
  (select array_agg(p.proname::text order by p.proname)
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'private') and has_function_privilege('anon', p.oid, 'execute'))
  = array['public_appointment_types', 'public_business_details', 'public_wording',
          'record_visit', 'submit_enquiry_with_access'],
  'anon may run only the five public functions');
set local role anon;
select pg_temp.expect_error('select * from public.quotes', '42501');
select pg_temp.expect_error(format('select public.send_quote(%L, 1000, array[''Tiling''])', pg_temp.id('a')), '42501');
reset role;
set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-000000000db3');
select pg_temp.expect_error(format('select public.send_quote(%L, 1000, array[''Tiling''])', pg_temp.id('a')), '42501');
select pg_temp.as_user('00000000-0000-4000-8000-000000000db2');
select pg_temp.expect_error(format('select public.send_quote(%L, 1000, array[''Tiling''])', pg_temp.id('a')), '42501');

-- What's not included: seeded, learnable per kind (the same label may be on both lists).
select pg_temp.as_user('00000000-0000-4000-8000-000000000db1');
select pg_temp.expect((select array_agg(label order by position) from public.estimate_work_items where kind = 'excluded')
  @> array['Extra work found once the job is opened up', 'Site toilet', 'Waste removal', 'Appliances',
           'Painting and decorating', 'Furniture and fittings not listed', 'Planning or certification fees'],
  'excluded seed');
insert into r values ('x1', to_jsonb(public.add_estimate_work_item(null, 'Skip hire', 'excluded')));
select pg_temp.expect((select kind = 'excluded' from public.estimate_work_items where id = pg_temp.id('x1')), 'excluded added');
select pg_temp.expect(public.add_estimate_work_item(null, 'skip HIRE', 'excluded') = pg_temp.id('x1'), 'same, any case');
select pg_temp.expect(public.add_estimate_work_item(null, 'Skip hire') <> pg_temp.id('x1'), 'included is its own list');
select pg_temp.expect_error('select public.add_estimate_work_item(null, ''Odd'', ''other'')', '22023');

-- send_quote: numbered, deposit computed, 15 working days, terms snapshot, outcome quoted, email queued.
insert into r values ('q1', to_jsonb(public.send_quote(pg_temp.id('a'), 10200,
  array['New units and worktop', ' Tiled  floor '], array['Appliances'], ' Window stays. ', null)));
reset role;
select pg_temp.expect((select number ~ '^Q3-Q-[0-9]{4,}$' and version = 1 and deposit_eur = 1020
  and included = array['New units and worktop', 'Tiled floor'] and excluded = array['Appliances']
  and note = 'Window stays.' and created_by_name = 'Staff Q'
  and valid_until = private.add_working_days((now() at time zone 'Europe/Dublin')::date, 15)
  and terms like '%It’s good until ' || private.long_date(valid_until) || '.%'
  from public.quotes where id = pg_temp.id('q1')), 'quote stored');
select pg_temp.expect((select outcome = 'quoted' and quote_amount = 10200
  and quote_date = (now() at time zone 'Europe/Dublin')::date from public.enquiries where id = pg_temp.id('a')), 'outcome quoted');
select pg_temp.expect((select count(*) = 1 from public.communications
  where quote_id = pg_temp.id('q1') and template = 'quote' and recipient = 'estimate@example.invalid'), 'email queued');
select pg_temp.expect((select count(*) = 1 from public.enquiry_events
  where enquiry_id = pg_temp.id('a') and kind = 'quote_sent'), 'event');

-- A later version keeps the number; another enquiry gets the next number.
set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-000000000db1');
insert into r values ('q2', to_jsonb(public.send_quote(pg_temp.id('a'), 11000, array['New units and worktop'])));
insert into r values ('q3', to_jsonb(public.send_quote(pg_temp.id('c'), 5000, array['Tiling'])));
select pg_temp.expect((select q2.number = q1.number and q2.version = 2 and q3.number <> q1.number and q3.version = 1
  from public.quotes q1, public.quotes q2, public.quotes q3
  where q1.id = pg_temp.id('q1') and q2.id = pg_temp.id('q2') and q3.id = pg_temp.id('q3')), 'numbering');
select pg_temp.expect((select quote_amount = 11000 from public.enquiries where id = pg_temp.id('a')), 'outcome follows');
-- Refusals: price, nothing included, repeats, no email, won or lost.
select pg_temp.expect_error(format('select public.send_quote(%L, 50, array[''Tiling''])', pg_temp.id('a')), '22023');
select pg_temp.expect_error(format('select public.send_quote(%L, 1000, array[]::text[])', pg_temp.id('a')), '22023');
select pg_temp.expect_error(format('select public.send_quote(%L, 1000, array[''Tiling'', ''tiling''])', pg_temp.id('a')), '22023');
select pg_temp.expect_error(format('select public.send_quote(%L, 1000, array[''Tiling''])', pg_temp.id('n')), '22023');
select pg_temp.expect_error(format('select public.send_quote(%L, 1000, array[''Tiling''], ''{}'', null, %L)',
  pg_temp.id('a'), '00000000-0000-4000-8000-00000000dead'), 'P0002');
select public.record_enquiry_outcome(pg_temp.id('c'), 'won', 5000, (now() at time zone 'Europe/Dublin')::date);
select pg_temp.expect_error(format('select public.send_quote(%L, 1000, array[''Tiling''])', pg_temp.id('c')), '22023');
select pg_temp.expect((select count(*) = 3 from public.quotes where enquiry_id in (pg_temp.id('a'), pg_temp.id('c'))), 'staff read');
select pg_temp.as_user('00000000-0000-4000-8000-000000000db3');
select pg_temp.expect((select count(*) = 0 from public.quotes), 'outsider reads none');
reset role;

-- "Ask for a change" (public-booking, as postgres after the token check).
select pg_temp.expect(private.request_quote_change(pg_temp.id('a'), pg_temp.id('q2'), '  Add the utility room. ') = 'requested', 'asked');
select pg_temp.expect((select change_requested_at is not null and change_request_text = 'Add the utility room.'
  from public.quotes where id = pg_temp.id('q2')), 'recorded');
select pg_temp.expect((select count(*) >= 1 from public.communications
  where quote_id = pg_temp.id('q2') and template = 'staff_quote_change'), 'staff alerted');
select pg_temp.expect((select count(*) = 1 from public.enquiry_events
  where enquiry_id = pg_temp.id('a') and kind = 'quote_change_requested'), 'event');
select pg_temp.expect(private.request_quote_change(pg_temp.id('c'), pg_temp.id('q2'), 'x') = 'not_found', 'other enquiry');
select pg_temp.expect_error(format('select private.request_quote_change(%L, %L, ''  '')', pg_temp.id('a'), pg_temp.id('q2')), '22023');

rollback;
