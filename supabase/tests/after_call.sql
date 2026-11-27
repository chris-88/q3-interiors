-- After the introductory call: "We already spoke", the site visit link, estimates from a
-- call, and a visit after an attended call. One transaction, always rolled back.
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
  ('00000000-0000-4000-8000-000000000cb1', 'authenticated', 'authenticated', 'staffc@example.invalid'),
  ('00000000-0000-4000-8000-000000000cb2', 'authenticated', 'authenticated', 'offc@example.invalid'),
  ('00000000-0000-4000-8000-000000000cb3', 'authenticated', 'authenticated', 'outsiderc@example.invalid');
select private.add_staff('00000000-0000-4000-8000-000000000cb1', 'staffc@example.invalid', 'Staff C', 'staff');
select private.add_staff('00000000-0000-4000-8000-000000000cb2', 'offc@example.invalid', 'Off C', 'staff');
select private.set_staff_active('00000000-0000-4000-8000-000000000cb2', false);

insert into r values
  ('a', to_jsonb(pg_temp.enquiry('00000000-0000-4000-8000-000000000ca1', 'estimate@example.invalid'))),
  ('b', to_jsonb(pg_temp.enquiry('00000000-0000-4000-8000-000000000ca2', 'other@example.invalid')));

-- A confirmed site visit and a confirmed call, far in the future so nothing overlaps.
create function pg_temp.booking(p_name text, p_enquiry uuid, p_type text, p_state public.booking_state, p_day text)
returns void language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  insert into public.bookings (id, enquiry_id, staff_user_id, appointment_type_id, starts_at, ends_at,
    blocked, state, idempotency_key, calendar_event_id)
  values (v, p_enquiry, '00000000-0000-4000-8000-000000000cb1', p_type,
    (p_day || ' 10:00+00')::timestamptz, (p_day || ' 11:00+00')::timestamptz,
    tstzrange((p_day || ' 10:00+00')::timestamptz, (p_day || ' 11:00+00')::timestamptz),
    p_state, gen_random_uuid(), 'q3' || replace(v::text, '-', ''));
  insert into r values (p_name, to_jsonb(v));
end;
$$;

-- More enquiries: c (a call to come), d (nothing booked), e (no email), f (a site visit to come).
insert into r values
  ('c', to_jsonb(pg_temp.enquiry('00000000-0000-4000-8000-000000000ca3', 'callc@example.invalid'))),
  ('d', to_jsonb(pg_temp.enquiry('00000000-0000-4000-8000-000000000ca4', 'calld@example.invalid'))),
  ('f', to_jsonb(pg_temp.enquiry('00000000-0000-4000-8000-000000000ca6', 'callf@example.invalid')));
insert into r values ('e', to_jsonb(pg_temp.enquiry('00000000-0000-4000-8000-000000000ca5', 'calle@example.invalid')));
update public.enquiries set answers = answers - 'email' where id = pg_temp.id('e');
select pg_temp.booking('call_c', pg_temp.id('c'), 'phone_consultation', 'confirmed', '2099-03-02');
-- A site visit to come on b, and a call to come on g.
insert into r values ('g', to_jsonb(pg_temp.enquiry('00000000-0000-4000-8000-000000000ca7', 'callg@example.invalid')));
select pg_temp.booking('visit', pg_temp.id('b'), 'site_visit', 'confirmed', '2099-03-05');
select pg_temp.booking('call', pg_temp.id('g'), 'phone_consultation', 'confirmed', '2099-03-06');
select pg_temp.booking('visit_f', pg_temp.id('f'), 'site_visit', 'confirmed', '2099-03-03');
-- A call that already happened, on a: confirmed, attendance not yet recorded.
select pg_temp.booking('past_a', pg_temp.id('a'), 'phone_consultation', 'confirmed', '2020-01-06');

-- Anon: none of it, and the anon function list is unchanged (five).
select pg_temp.expect(
  (select array_agg(p.proname::text order by p.proname)
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'private') and has_function_privilege('anon', p.oid, 'execute'))
  = array['public_appointment_types', 'public_business_details', 'public_wording',
          'record_visit', 'submit_enquiry_with_access'],
  'anon may run only the five public functions');
set local role anon;
select pg_temp.expect_error(format('select public.record_call_held_early(%L)', pg_temp.id('d')), '42501');
select pg_temp.expect_error(format('select public.send_visit_link(%L)', pg_temp.id('d')), '42501');
reset role;
set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-000000000cb3');
select pg_temp.expect_error(format('select public.record_call_held_early(%L)', pg_temp.id('d')), '42501');
select pg_temp.as_user('00000000-0000-4000-8000-000000000cb2');
select pg_temp.expect_error(format('select public.send_visit_link(%L)', pg_temp.id('d')), '42501');

-- "We already spoke" with a call to come: cancelled quietly, the time freed, the call held.
select pg_temp.as_user('00000000-0000-4000-8000-000000000cb1');
select pg_temp.expect(public.record_call_held_early(pg_temp.id('c')) = '{"cancelled": 1}'::jsonb, 'one call cancelled');
reset role;
select pg_temp.expect((select state = 'cancelled' and cancelled_by = 'staff' and cancel_reason = 'Spoke before the call'
  from public.bookings where id = pg_temp.id('call_c')), 'call cancelled');
select pg_temp.expect((select count(*) = 0 from public.communications
  where booking_id = pg_temp.id('call_c') and template = 'booking_cancelled'), 'no cancellation email');
select pg_temp.expect((select count(*) = 1 from public.integration_jobs
  where booking_id = pg_temp.id('call_c') and kind = 'delete_calendar_event'), 'calendar event removed');
select pg_temp.expect((select call_held_at is not null from public.enquiries where id = pg_temp.id('c')), 'call held');
select pg_temp.expect((select count(*) = 1 from public.enquiry_events
  where enquiry_id = pg_temp.id('c') and kind = 'call_held_early' and actor_name = 'Staff C'), 'event');

-- With nothing booked: held, nothing cancelled. With a site visit to come: refused.
set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-000000000cb1');
select pg_temp.expect(public.record_call_held_early(pg_temp.id('d')) = '{"cancelled": 0}'::jsonb, 'none cancelled');
select pg_temp.expect_error(format('select public.record_call_held_early(%L)', pg_temp.id('f')), '22023');
select pg_temp.expect_error('select public.record_call_held_early(''00000000-0000-4000-8000-00000000dead'')', 'P0002');

-- The booking link: queued per press, with the date; refused without an email or with a visit booked.
select public.send_visit_link(pg_temp.id('d'));
select public.send_visit_link(pg_temp.id('d'));
select pg_temp.expect_error(format('select public.send_visit_link(%L)', pg_temp.id('e')), '22023');
select pg_temp.expect_error(format('select public.send_visit_link(%L)', pg_temp.id('f')), '22023');
reset role;
select pg_temp.expect((select count(*) = 2 from public.communications
  where enquiry_id = pg_temp.id('d') and template = 'visit_link' and booking_id is null
    and recipient = 'calld@example.invalid'), 'two links queued');
select pg_temp.expect((select visit_link_sent_at is not null from public.enquiries where id = pg_temp.id('d')), 'link sent at');
select pg_temp.expect((select count(*) = 2 from public.enquiry_events
  where enquiry_id = pg_temp.id('d') and kind = 'visit_link_sent'), 'link events');

-- An estimate straight from the call: with no booking (held early), or on an attended call.
set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-000000000cb1');
insert into r values ('est_d', to_jsonb(public.send_estimate(null, 5000, 10, null, array['Tiling'], pg_temp.id('d'))));
select pg_temp.expect((select after = 'call' and booking_id is null and enquiry_id = pg_temp.id('d')
  and caveats = coalesce(nullif(btrim((select body from public.message_blocks where key = 'estimate_call_caveats')), ''),
    'This is an estimate, not a quote. It’s a price range based on what you told us on the call, with VAT included. It could change once we see the space, or if the scope changes. It’s good for 10 days. If you want to go ahead, tell us and we’ll send your quote: one price, with what’s included and what isn’t.')
  from public.estimates where id = pg_temp.id('est_d')), 'estimate after the call, call caveats');
select pg_temp.expect_error(format('select public.send_estimate(null, 5000, 10, null, array[''Tiling''], %L)', pg_temp.id('g')), '22023');
select pg_temp.expect_error('select public.send_estimate(null, 5000, 10, null, array[''Tiling''])', 'P0002');
-- A call not marked attended is not a held call.
select pg_temp.expect_error(format('select public.send_estimate(%L, 5000, 10, null, array[''Tiling''])', pg_temp.id('past_a')), '22023');
select pg_temp.expect_error(format('select public.send_estimate(%L, 5000, 10, null, array[''Tiling''])', pg_temp.id('call')), '22023');
reset role;
update public.bookings set attendance = 'attended', attendance_at = now() where id = pg_temp.id('past_a');
set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-000000000cb1');
insert into r values ('est_a', to_jsonb(public.send_estimate(pg_temp.id('past_a'), 5000, 10, null, array['Tiling'])));
select pg_temp.expect((select after = 'call' and booking_id = pg_temp.id('past_a') from public.estimates
  where id = pg_temp.id('est_a')), 'estimate on an attended call');
-- A site visit still gives a visit estimate with the visit caveats.
insert into r values ('est_v', to_jsonb(public.send_estimate(pg_temp.id('visit'), 5000, 10, null, array['Tiling'])));
select pg_temp.expect((select after = 'visit' from public.estimates where id = pg_temp.id('est_v')), 'visit estimate');
-- Another enquiry's booking with this enquiry named is refused.
select pg_temp.expect_error(format('select public.send_estimate(%L, 5000, 10, null, array[''Tiling''], %L)',
  pg_temp.id('visit'), pg_temp.id('d')), 'P0002');
reset role;

-- One live booking per enquiry, but an attended past call no longer counts: a visit can follow.
select pg_temp.expect_error(format($q$insert into public.bookings (enquiry_id, staff_user_id, appointment_type_id,
  starts_at, ends_at, blocked, state, idempotency_key, calendar_event_id) values (%L,
  '00000000-0000-4000-8000-000000000cb1', 'site_visit', '2099-03-10 10:00+00', '2099-03-10 11:00+00',
  tstzrange('2099-03-10 10:00+00', '2099-03-10 11:00+00'), 'confirmed', gen_random_uuid(), 'q3x1')$q$,
  pg_temp.id('b')), '23505');
select pg_temp.booking('visit_a2', pg_temp.id('a'), 'site_visit', 'confirmed', '2099-03-11');
select pg_temp.expect((select count(*) = 1 from public.bookings where id = pg_temp.id('visit_a2')), 'visit after an attended call');

rollback;
