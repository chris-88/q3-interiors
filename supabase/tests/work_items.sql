-- The estimate form's tick-list of work items (estimate_work_items, add/archive, send_estimate's
-- items). One transaction, always rolled back.
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
  ('00000000-0000-4000-8000-000000000fb1', 'authenticated', 'authenticated', 'stafff@example.invalid'),
  ('00000000-0000-4000-8000-000000000fb2', 'authenticated', 'authenticated', 'offf@example.invalid'),
  ('00000000-0000-4000-8000-000000000fb3', 'authenticated', 'authenticated', 'outsiderf@example.invalid');
select private.add_staff('00000000-0000-4000-8000-000000000fb1', 'stafff@example.invalid', 'Staff F', 'staff');
select private.add_staff('00000000-0000-4000-8000-000000000fb2', 'offf@example.invalid', 'Off F', 'staff');
select private.set_staff_active('00000000-0000-4000-8000-000000000fb2', false);

insert into r values
  ('a', to_jsonb(pg_temp.enquiry('00000000-0000-4000-8000-000000000fa1', 'estimate@example.invalid'))),
  ('b', to_jsonb(pg_temp.enquiry('00000000-0000-4000-8000-000000000fa2', 'other@example.invalid')));

-- A confirmed site visit and a confirmed call, far in the future so nothing overlaps.
create function pg_temp.booking(p_name text, p_enquiry uuid, p_type text, p_state public.booking_state, p_day text)
returns void language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  insert into public.bookings (id, enquiry_id, staff_user_id, appointment_type_id, starts_at, ends_at,
    blocked, state, idempotency_key, calendar_event_id)
  values (v, p_enquiry, '00000000-0000-4000-8000-000000000fb1', p_type,
    (p_day || ' 10:00+00')::timestamptz, (p_day || ' 11:00+00')::timestamptz,
    tstzrange((p_day || ' 10:00+00')::timestamptz, (p_day || ' 11:00+00')::timestamptz),
    p_state, gen_random_uuid(), 'q3' || replace(v::text, '-', ''));
  insert into r values (p_name, to_jsonb(v));
end;
$$;
insert into r values ('caveats', to_jsonb(private.estimate_caveats_default()));
delete from public.message_blocks where key = 'estimate_caveats';
select pg_temp.booking('visit', pg_temp.id('a'), 'site_visit', 'confirmed', '2099-02-05');
select pg_temp.booking('call', pg_temp.id('b'), 'phone_consultation', 'confirmed', '2099-02-06');


-- The seed: each job type's items and the "any job" ones, in order.
select pg_temp.expect((select count(*) = 9 from public.estimate_work_items where project_type = 'kitchen'), 'kitchen seed');
select pg_temp.expect((select count(*) = 12 from public.estimate_work_items where project_type is null and kind = 'included'), 'any-job seed');
select pg_temp.expect((select array_agg(label order by position) from public.estimate_work_items where project_type = 'attic')
  = array['Structural work', 'Stairs', 'Roof windows', 'Insulation', 'Electrics', 'Plastering', 'Flooring', 'Painting'],
  'attic seed in order');

-- Access: anon nothing; the anon function list is unchanged (five).
select pg_temp.expect(
  (select array_agg(p.proname::text order by p.proname)
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'private') and has_function_privilege('anon', p.oid, 'execute'))
  = array['public_appointment_types', 'public_business_details', 'public_wording',
          'record_visit', 'submit_enquiry_with_access'],
  'anon may run only the five public functions');
set local role anon;
select pg_temp.expect_error('select * from public.estimate_work_items', '42501');
select pg_temp.expect_error('select public.add_estimate_work_item(''kitchen'', ''Anon item'')', '42501');
reset role;
set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-000000000fb3');
select pg_temp.expect((select count(*) = 0 from public.estimate_work_items), 'outsider reads none');
select pg_temp.expect_error('select public.add_estimate_work_item(''kitchen'', ''Outsider item'')', '42501');
select pg_temp.as_user('00000000-0000-4000-8000-000000000fb2');
select pg_temp.expect_error('select public.add_estimate_work_item(''kitchen'', ''Off item'')', '42501');

-- Staff: read; no direct writes.
select pg_temp.as_user('00000000-0000-4000-8000-000000000fb1');
select pg_temp.expect((select count(*) >= 57 from public.estimate_work_items), 'staff read the list');
select pg_temp.expect_error('insert into public.estimate_work_items (label) values (''Direct'')', '42501');
select pg_temp.expect_error('update public.estimate_work_items set archived_at = now()', '42501');

-- Add: tidied, validated, one per type and label whatever the case; a repeat brings it back.
insert into r values ('w1', to_jsonb(public.add_estimate_work_item('kitchen', '  Move the   radiator ')));
select pg_temp.expect((select label = 'Move the radiator' and project_type = 'kitchen' and archived_at is null
  and created_by = '00000000-0000-4000-8000-000000000fb1'
  from public.estimate_work_items where id = pg_temp.id('w1')), 'added, tidied');
select pg_temp.expect(public.add_estimate_work_item('kitchen', 'move the RADIATOR') = pg_temp.id('w1'), 'same item, any case');
insert into r values ('w2', to_jsonb(public.add_estimate_work_item(null, 'Move the radiator')));
select pg_temp.expect(pg_temp.id('w2') <> pg_temp.id('w1'), 'any job is its own list');
select pg_temp.expect_error('select public.add_estimate_work_item(''kitchen'', ''x'')', '22023');
select pg_temp.expect_error(format('select public.add_estimate_work_item(''kitchen'', %L)', repeat('x', 61)), '22023');
select pg_temp.expect_error('select public.add_estimate_work_item(''Kitchen!'', ''Bad type'')', '22023');

-- Remove: archived, no longer offered; adding it again brings it back.
select public.archive_estimate_work_item(pg_temp.id('w1'));
select pg_temp.expect((select archived_at is not null from public.estimate_work_items where id = pg_temp.id('w1')), 'archived');
select pg_temp.expect_error('select public.archive_estimate_work_item(''00000000-0000-4000-8000-00000000dead'')', 'P0002');
select pg_temp.expect(public.add_estimate_work_item('kitchen', 'Move the radiator') = pg_temp.id('w1'), 'brought back');
select pg_temp.expect((select archived_at is null from public.estimate_work_items where id = pg_temp.id('w1')), 'offered again');
reset role;
select pg_temp.expect_error('insert into public.estimate_work_items (project_type, label) values (''kitchen'', ''TILED FLOOR'')', '23505');

-- send_estimate with ticked items: kept in the order given, as a snapshot; note optional.
set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-000000000fb1');
insert into r values ('e1', to_jsonb(public.send_estimate(pg_temp.id('visit'), 10000, 5, null,
  array['Tiled floor', '  Strip out the old kitchen ', 'Move the radiator'])));
select pg_temp.expect((select work_items = array['Tiled floor', 'Strip out the old kitchen', 'Move the radiator']
  and work_looked_at is null from public.estimates where id = pg_temp.id('e1')), 'items as sent, no note');
insert into r values ('e2', to_jsonb(public.send_estimate(pg_temp.id('visit'), 10000, 5, 'Keep the window.', array['Painting'])));
select pg_temp.expect((select work_items = array['Painting'] and work_looked_at = 'Keep the window.'
  from public.estimates where id = pg_temp.id('e2')), 'items and a note');
-- A console loaded before the tick-list still sends (note only, no items argument).
insert into r values ('e3', to_jsonb(public.send_estimate(pg_temp.id('visit'), 10000, 5, 'Hall floor')));
select pg_temp.expect((select work_items = '{}' and work_looked_at = 'Hall floor'
  from public.estimates where id = pg_temp.id('e3')), 'older console');
select pg_temp.expect_error(format('select public.send_estimate(%L, 1000, 10, null, array[]::text[])', pg_temp.id('visit')), '22023');
select pg_temp.expect_error(format('select public.send_estimate(%L, 1000, 10, null, array[''Painting'', ''painting''])', pg_temp.id('visit')), '22023');
select pg_temp.expect_error(format('select public.send_estimate(%L, 1000, 10, null, array[''x''])', pg_temp.id('visit')), '22023');
select pg_temp.expect_error(format('select public.send_estimate(%L, 1000, 10, null, array[%L])', pg_temp.id('visit'), repeat('x', 61)), '22023');
select pg_temp.expect_error(format('select public.send_estimate(%L, 1000, 10, null, array[null::text])', pg_temp.id('visit')), '22023');
reset role;
-- Removing an item later leaves the estimates that carried it as they were.
update public.estimate_work_items set archived_at = now() where project_type = 'kitchen' and label = 'Tiled floor';
select pg_temp.expect((select work_items[1] = 'Tiled floor' from public.estimates where id = pg_temp.id('e1')), 'snapshot kept');
select pg_temp.expect_error(format('insert into public.estimates (enquiry_id, price_eur, plus_minus_percent, low_eur, high_eur, work_items, work_looked_at, caveats, sent_at, valid_until) values (%L, 1000, 10, 900, 1100, ''{}'', null, ''c'', now(), now() + interval ''10 days'')', pg_temp.id('a')), '23514');

rollback;
