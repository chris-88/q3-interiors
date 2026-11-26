-- Staff notes on an enquiry (add_enquiry_note). One transaction, always rolled back.
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

create function pg_temp.enquiry(p_key text) returns uuid language plpgsql as $$
declare v jsonb;
begin
  v := public.submit_enquiry_with_access(p_key::uuid, 'enquiry', 2,
    '{"appointment_preference": "phone", "project_type": "kitchen", "location": "Dublin 8",
      "name": "Test Person", "email": "notes@example.invalid", "phone": "087 123 4567"}'::jsonb);
  return (select id from public.enquiries where reference = v ->> 'reference');
end;
$$;
insert into r values ('a', to_jsonb(pg_temp.enquiry('00000000-0000-4000-8000-0000000009a1')));
create function pg_temp.id(p text) returns uuid language sql as $$
  select (value #>> '{}')::uuid from r where name = p
$$;

insert into auth.users (id, aud, role, email) values
  ('00000000-0000-4000-8000-0000000009b1', 'authenticated', 'authenticated', 'staffn@example.invalid'),
  ('00000000-0000-4000-8000-0000000009b2', 'authenticated', 'authenticated', 'offn@example.invalid'),
  ('00000000-0000-4000-8000-0000000009b3', 'authenticated', 'authenticated', 'outsidern@example.invalid');
select private.add_staff('00000000-0000-4000-8000-0000000009b1', 'staffn@example.invalid', 'Staff N', 'staff');
select private.add_staff('00000000-0000-4000-8000-0000000009b2', 'offn@example.invalid', 'Off N', 'staff');
select private.set_staff_active('00000000-0000-4000-8000-0000000009b2', false);

-- Access: not anon, not a signed-in outsider, not a deactivated staff member.
set local role anon;
select pg_temp.expect_error(format('select public.add_enquiry_note(%L, ''hello'')', pg_temp.id('a')), '42501');
reset role;
select pg_temp.expect(
  (select array_agg(p.proname::text order by p.proname)
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'private') and has_function_privilege('anon', p.oid, 'execute'))
  = array['public_appointment_types', 'public_business_details', 'public_wording',
          'record_visit', 'submit_enquiry_with_access'],
  'anon may run only the five public functions');

set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-0000000009b3');
select pg_temp.expect_error(format('select public.add_enquiry_note(%L, ''hello'')', pg_temp.id('a')), '42501');
select pg_temp.as_user('00000000-0000-4000-8000-0000000009b2');
select pg_temp.expect_error(format('select public.add_enquiry_note(%L, ''hello'')', pg_temp.id('a')), '42501');

-- Validation.
select pg_temp.as_user('00000000-0000-4000-8000-0000000009b1');
select pg_temp.expect_error(format('select public.add_enquiry_note(%L, ''   '')', pg_temp.id('a')), '22023');
select pg_temp.expect_error(format('select public.add_enquiry_note(%L, null)', pg_temp.id('a')), '22023');
select pg_temp.expect_error(format('select public.add_enquiry_note(%L, %L)', pg_temp.id('a'), repeat('x', 1001)), '22023');
select pg_temp.expect_error('select public.add_enquiry_note(''00000000-0000-4000-8000-00000000dead'', ''hello'')', 'P0002');

-- A note is one history row with the trimmed text and the author.
select public.add_enquiry_note(pg_temp.id('a'), '  Rang twice, no answer.  ');
select public.add_enquiry_note(pg_temp.id('a'), repeat('y', 1000));
reset role;
select pg_temp.expect((select count(*) = 2 from public.enquiry_events
  where enquiry_id = pg_temp.id('a') and kind = 'note_added'), 'two notes');
select pg_temp.expect(exists (select 1 from public.enquiry_events
  where enquiry_id = pg_temp.id('a') and kind = 'note_added' and detail = 'Rang twice, no answer.'
    and actor_name = 'Staff N' and actor_user_id = '00000000-0000-4000-8000-0000000009b1'),
  'trimmed text and author');
-- Staff can read it back through RLS.
set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-0000000009b1');
select pg_temp.expect((select count(*) = 2 from public.enquiry_events
  where enquiry_id = pg_temp.id('a') and kind = 'note_added'), 'staff read notes');
-- Nobody writes history directly.
select pg_temp.expect_error(format(
  'insert into public.enquiry_events (enquiry_id, kind, detail) values (%L, ''note_added'', ''x'')',
  pg_temp.id('a')), '42501');
reset role;

rollback;
