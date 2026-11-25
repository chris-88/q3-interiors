-- Enquiry form v2 checks against the real database, in one transaction that is always rolled
-- back. Run with `npm run test:db` (after published.sql has published enquiry@2).
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

-- Room for every submission below in this transaction.
update public.booking_settings set enquiry_limit_per_hour = 100;

select pg_temp.expect(
  exists (select 1 from public.form_versions where form_id = 'enquiry' and version = 2),
  'enquiry@2 is published');

create function pg_temp.call_answers() returns jsonb language sql as $$
  select '{"appointment_preference": "phone", "project_type": "kitchen", "kitchen_layout": "changing",
           "location": "Dublin 8", "name": "Test Person", "email": "v2call@example.invalid",
           "phone": "087 123 4567"}'::jsonb
$$;
create function pg_temp.visit_answers() returns jsonb language sql as $$
  select '{"appointment_preference": "on_site", "project_type": "other",
           "project_type_other": "Garden room", "location": "D07 X2Y3",
           "name": "Test Person", "email": "v2visit@example.invalid", "phone": "087 123 4567",
           "site_street": "12 Example Road", "site_unit": "Apt 3"}'::jsonb
$$;

-- The whole set of functions anon may run (public and private schemas). Adding one is a
-- decision: change this list with it.
select pg_temp.expect(
  (select array_agg(p.proname::text order by p.proname)
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'private') and has_function_privilege('anon', p.oid, 'execute'))
  = array['public_appointment_types', 'public_business_details', 'public_wording',
          'submit_enquiry_with_access'],
  'anon may run only the four public functions');

-- -------------------------------------------------------------------------------------------
-- anon: the landing durations, and v2 submissions
-- -------------------------------------------------------------------------------------------
set local role anon;

insert into r values ('types', public.public_appointment_types());
select pg_temp.expect(jsonb_typeof((select value from r where name = 'types')) = 'array', 'types is a list');
select pg_temp.expect(
  (select bool_and(t ?& array['id', 'mode', 'duration_minutes'] and not t ? 'what_to_prepare')
   from jsonb_array_elements((select value from r where name = 'types')) as t),
  'types carry only id, mode and duration');

insert into r values ('call', public.submit_enquiry_with_access(
  '00000000-0000-4000-8000-0000000002c1', 'enquiry', 2, pg_temp.call_answers()));
insert into r values ('visit', public.submit_enquiry_with_access(
  '00000000-0000-4000-8000-0000000002c2', 'enquiry', 2, pg_temp.visit_answers()));

-- Required follow-up and required address are enforced by the stored schema.
select pg_temp.expect_error(format(
  'select public.submit_enquiry_with_access(%L, ''enquiry'', 2, %L)',
  '00000000-0000-4000-8000-0000000002c3', pg_temp.visit_answers() - 'project_type_other'), '22023');
select pg_temp.expect_error(format(
  'select public.submit_enquiry_with_access(%L, ''enquiry'', 2, %L)',
  '00000000-0000-4000-8000-0000000002c4', pg_temp.visit_answers() - 'site_street'), '22023');
-- The phone is required on both routes.
select pg_temp.expect_error(format(
  'select public.submit_enquiry_with_access(%L, ''enquiry'', 2, %L)',
  '00000000-0000-4000-8000-0000000002c5', pg_temp.call_answers() - 'phone'), '22023');
-- A preference outside the two choices is refused.
select pg_temp.expect_error(format(
  'select public.submit_enquiry_with_access(%L, ''enquiry'', 2, %L)',
  '00000000-0000-4000-8000-0000000002c6',
  pg_temp.call_answers() || '{"appointment_preference": "video"}'), '22023');

-- anon cannot reach the private helpers.
select pg_temp.expect_error(
  'select private.update_enquiry_details(gen_random_uuid(), ''{"phone": "0871234567"}'')', '42501');
reset role;

-- -------------------------------------------------------------------------------------------
-- What was stored
-- -------------------------------------------------------------------------------------------
create function pg_temp.enquiry(p_name text) returns public.enquiries language sql as $$
  select e.* from public.enquiries e
  where e.reference = (select value ->> 'reference' from r where name = p_name)
$$;

select pg_temp.expect((pg_temp.enquiry('call')).form_version = 2, 'call saved as v2');
select pg_temp.expect((pg_temp.enquiry('call')).answers ->> 'appointment_preference' = 'phone',
  'the preference is saved with the enquiry');
select pg_temp.expect((pg_temp.enquiry('call')).answers ->> 'kitchen_layout' = 'changing',
  'the kitchen follow-up is saved');
select pg_temp.expect((pg_temp.enquiry('call')).site_details is null, 'a call has no site details');

select pg_temp.expect(
  (pg_temp.enquiry('visit')).site_details ->> 'site_address' = '12 Example Road, Apt 3, D07 X2Y3',
  'a visit enquiry carries its address into the site details');
select pg_temp.expect(
  public.enquiry_booking_eligibility((pg_temp.enquiry('visit')).id, 'site_visit') = 'eligible',
  'a v2 visit enquiry may book a visit straight away');
select pg_temp.expect(
  public.enquiry_booking_eligibility((pg_temp.enquiry('call')).id, 'site_visit') = 'site_address_required',
  'a v2 call enquiry needs an address before a visit');
select pg_temp.expect(
  (select count(*) from public.enquiry_revisions where enquiry_id = (pg_temp.enquiry('visit')).id) = 2,
  'the visit enquiry has its answers and its site details as revisions');
select pg_temp.expect(
  exists (select 1 from public.communications
          where enquiry_id = (pg_temp.enquiry('visit')).id and template = 'staff_new_enquiry')
  or not exists (select 1 from public.staff),
  'staff are alerted to the v2 enquiry');

-- -------------------------------------------------------------------------------------------
-- Changing details after the save (the public-booking function runs these as postgres)
-- -------------------------------------------------------------------------------------------
select private.update_enquiry_details((pg_temp.enquiry('call')).id, '{"phone": "01 234 5678"}');
select pg_temp.expect((pg_temp.enquiry('call')).answers ->> 'phone' = '01 234 5678', 'phone changed');
select pg_temp.expect(
  exists (select 1 from public.enquiry_events
          where enquiry_id = (pg_temp.enquiry('call')).id and kind = 'details_updated'
            and detail = 'Phone number'),
  'a details_updated event names the changed question');
-- Repeating the same change adds nothing.
select private.update_enquiry_details((pg_temp.enquiry('call')).id, '{"phone": "01 234 5678"}');
select pg_temp.expect(
  (select count(*) from public.enquiry_events
   where enquiry_id = (pg_temp.enquiry('call')).id and kind = 'details_updated') = 1,
  'an unchanged detail is a no-op');

-- Switching the call to a visit needs the street, and then the address is in place.
select pg_temp.expect_error(format(
  'select private.update_enquiry_details(%L, ''{"appointment_preference": "on_site"}'')',
  (pg_temp.enquiry('call')).id), '22023');
select private.update_enquiry_details((pg_temp.enquiry('call')).id,
  '{"appointment_preference": "on_site", "site_street": "4 Sample Street"}');
select pg_temp.expect(
  (pg_temp.enquiry('call')).site_details ->> 'site_address' = '4 Sample Street, Dublin 8',
  'the switch carries the town forward into the visit address');
select pg_temp.expect(
  public.enquiry_booking_eligibility((pg_temp.enquiry('call')).id, 'site_visit') = 'eligible',
  'after the switch the visit may be booked');

-- Invalid input is refused without changing anything.
select pg_temp.expect_error(format(
  'select private.update_enquiry_details(%L, ''{"phone": "x"}'')', (pg_temp.enquiry('call')).id), '22023');
select pg_temp.expect_error(format(
  'select private.update_enquiry_details(%L, ''{"email": "a@example.invalid"}'')',
  (pg_temp.enquiry('call')).id), '22023');
select pg_temp.expect_error(format(
  'select private.update_enquiry_details(%L, ''{}'')', (pg_temp.enquiry('call')).id), '22023');

-- A v1 enquiry (links already issued keep working): the phone is in its form, the street goes
-- straight into its site details.
insert into r values ('v1', public.submit_enquiry_with_access(
  '00000000-0000-4000-8000-0000000002c7', 'enquiry', 1,
  '{"project_type": "kitchen", "description": "Replace the kitchen units and worktops.",
    "location": "D07 X2Y3", "timing": "flexible", "name": "Test Person",
    "email": "v1@example.invalid", "phone": "087 123 4567"}'::jsonb));
select private.update_enquiry_details((pg_temp.enquiry('v1')).id,
  '{"phone": "087 765 4321", "appointment_preference": "on_site", "site_street": "9 Old Lane"}');
select pg_temp.expect((pg_temp.enquiry('v1')).answers ->> 'phone' = '087 765 4321', 'v1 phone changed');
select pg_temp.expect(not ((pg_temp.enquiry('v1')).answers ? 'appointment_preference'),
  'a v1 enquiry does not gain v2 questions');
select pg_temp.expect(
  (pg_temp.enquiry('v1')).site_details ->> 'site_address' = '9 Old Lane, D07 X2Y3',
  'a v1 visit address goes into the site details');

rollback;
