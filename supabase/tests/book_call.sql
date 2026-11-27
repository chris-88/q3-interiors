-- Staff book a call for a customer: the history line written after the reserve, its access, and
-- the anon list. One transaction, always rolled back.
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
grant all on r to anon, authenticated;
update public.booking_settings set enquiry_limit_per_hour = 100;

create function pg_temp.enquiry(p_key text) returns uuid language plpgsql as $$
declare v jsonb;
begin
  v := public.submit_enquiry_with_access(p_key::uuid, 'enquiry', 2,
    '{"appointment_preference": "phone", "project_type": "kitchen", "location": "Dublin 8",
      "name": "Test Person", "email": "bookcall@example.invalid", "phone": "087 123 4567"}'::jsonb);
  return (select id from public.enquiries where reference = v ->> 'reference');
end;
$$;
insert into r values ('e', to_jsonb(pg_temp.enquiry('00000000-0000-4000-8000-0000000c0a11')));
create function pg_temp.id(p text) returns uuid language sql as $$
  select (value #>> '{}')::uuid from r where name = p
$$;
insert into auth.users (id, aud, role, email) values
  ('00000000-0000-4000-8000-0000000c0b11', 'authenticated', 'authenticated', 'bookcaller@example.invalid');
select private.add_staff('00000000-0000-4000-8000-0000000c0b11', 'bookcaller@example.invalid', 'Book Caller', 'staff');

-- The reserve the function makes (a call, ten days out at 10:00 Irish time).
insert into r values ('res', private.reserve_booking(pg_temp.id('e'), 'phone_consultation',
  ((current_date + 10)::timestamp + interval '10 hours') at time zone 'Europe/Dublin',
  '00000000-0000-4000-8000-0000000c0c11'));
select pg_temp.expect((select value ->> 'status' from r where name = 'res') = 'reserved', 'call reserved');

select private.call_booked_by_staff((select (value ->> 'booking_id')::uuid from r where name = 'res'),
  '00000000-0000-4000-8000-0000000c0b11');
select pg_temp.expect((select count(*) = 1 from public.enquiry_events
  where enquiry_id = pg_temp.id('e') and kind = 'call_booked_by_staff'
    and actor_name = 'Book Caller' and detail like 'Call booked for the customer at %'
    and booking_id = (select (value ->> 'booking_id')::uuid from r where name = 'res')),
  'one history line with the staff member and the time');
select pg_temp.expect_error('select private.call_booked_by_staff(gen_random_uuid(), null)', 'P0002');

-- Only the function (as postgres) writes it.
set local role authenticated;
select pg_temp.expect_error(format('select private.call_booked_by_staff(%L, null)',
  (select value ->> 'booking_id' from r where name = 'res')), '42501');
reset role;
set local role anon;
select pg_temp.expect_error(format('select private.call_booked_by_staff(%L, null)',
  (select value ->> 'booking_id' from r where name = 'res')), '42501');
reset role;

-- A second call while this one is to come is refused by the reserve path (one live booking).
insert into r values ('again', private.reserve_booking(pg_temp.id('e'), 'phone_consultation',
  ((current_date + 11)::timestamp + interval '10 hours') at time zone 'Europe/Dublin',
  '00000000-0000-4000-8000-0000000c0c12'));
select pg_temp.expect((select value ->> 'status' from r where name = 'again') = 'already_booked',
  'one appointment to come at a time');

-- The anon list is still exactly the five.
select pg_temp.expect(
  (select array_agg(p.proname::text order by p.proname)
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'private') and has_function_privilege('anon', p.oid, 'execute'))
  = array['public_appointment_types', 'public_business_details', 'public_wording',
          'record_visit', 'submit_enquiry_with_access'],
  'anon may run only the five public functions');

rollback;
