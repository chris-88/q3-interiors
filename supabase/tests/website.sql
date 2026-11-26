-- Links from the website: the stored inspiration slug and form enquiry@3 ("Workplace fit-out").
-- One transaction, always rolled back.
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
update public.booking_settings set enquiry_limit_per_hour = 100;

create function pg_temp.answers(p_type text) returns jsonb language sql as $$
  select jsonb_build_object('appointment_preference', 'on_site', 'project_type', p_type,
    'location', 'Dublin 2', 'name', 'Test Person', 'email', 'website@example.invalid',
    'phone', '087 123 4567', 'site_street', '1 Example Square')
$$;
create function pg_temp.reference(p_result jsonb) returns public.enquiries language sql as $$
  select * from public.enquiries where reference = p_result ->> 'reference'
$$;

-- The form: enquiry@3 is published and differs from @2 only by "Workplace fit-out".
select pg_temp.expect(exists (select 1 from public.form_versions where form_id = 'enquiry' and version = 3),
  'enquiry@3 is published');
select pg_temp.expect(
  (select jsonb_path_query_array(schema, '$.steps[*].fields[*] ? (@.id == "project_type").options[*].value')
   from public.form_versions where form_id = 'enquiry' and version = 3)
  = '["kitchen", "bathroom", "several_rooms", "whole_home", "extension", "attic", "workplace", "other"]',
  'workplace sits before other');
select pg_temp.expect(
  (select jsonb_path_query_array(schema, '$.steps[*].fields[*] ? (@.id == "project_type").options[*].label')
   from public.form_versions where form_id = 'enquiry' and version = 3) @> '["Workplace fit-out"]',
  'the label');

create temp table res (name text primary key, value jsonb);
grant all on res to anon;
grant execute on all functions in schema pg_temp to anon, authenticated;

-- As anon, through the one submission function.
set local role anon;

-- Workplace on v3 is accepted, with no follow-up; on v2 it is refused (option unknown there).
insert into res values ('work', public.submit_enquiry_with_access(
  '00000000-0000-4000-8000-00000000a0a1', 'enquiry', 3, pg_temp.answers('workplace'),
  p_inspiration => 'fitzwilliam-office'));
select pg_temp.expect_error($q$select public.submit_enquiry_with_access(
  '00000000-0000-4000-8000-00000000a0a2', 'enquiry', 2, pg_temp.answers('workplace'))$q$, '22023');
-- v2 still takes its own answers (pages loaded before this release), without inspiration.
insert into res values ('old', public.submit_enquiry_with_access(
  '00000000-0000-4000-8000-00000000a0a3', 'enquiry', 2, pg_temp.answers('kitchen'),
  false, null, null, null));
-- Inspiration: a slug only.
select pg_temp.expect_error($q$select public.submit_enquiry_with_access(
  '00000000-0000-4000-8000-00000000a0a4', 'enquiry', 3, pg_temp.answers('kitchen'),
  p_inspiration => 'Fairview, Dublin 3')$q$, '22023');
select pg_temp.expect_error($q$select public.submit_enquiry_with_access(
  '00000000-0000-4000-8000-00000000a0a5', 'enquiry', 3, pg_temp.answers('kitchen'),
  p_inspiration => repeat('a', 61))$q$, '22023');
insert into res values ('blank', public.submit_enquiry_with_access(
  '00000000-0000-4000-8000-00000000a0a6', 'enquiry', 3, pg_temp.answers('kitchen'),
  p_inspiration => '  '));
-- A retry with the same key returns the same reference and changes nothing.
insert into res values ('retry', public.submit_enquiry_with_access(
  '00000000-0000-4000-8000-00000000a0a1', 'enquiry', 3, pg_temp.answers('workplace'),
  p_inspiration => 'adelaide'));
-- Anon reads nothing back.
select pg_temp.expect_error('select inspiration from public.enquiries', '42501');
reset role;

select pg_temp.expect(
  (select array_agg(p.proname::text order by p.proname)
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'private') and has_function_privilege('anon', p.oid, 'execute'))
  = array['public_appointment_types', 'public_business_details', 'public_wording',
          'record_visit', 'submit_enquiry_with_access'],
  'anon may run only the five public functions');
select pg_temp.expect((select count(*) = 1 from pg_proc where proname = 'submit_enquiry_with_access'),
  'one submission function (no overload left behind)');

select pg_temp.expect((select inspiration = 'fitzwilliam-office' and form_version = 3
  and answers ->> 'project_type' = 'workplace'
  from pg_temp.reference((select value from res where name = 'work'))), 'stored with the enquiry');
select pg_temp.expect((select value ->> 'reference' from res where name = 'retry')
  = (select value ->> 'reference' from res where name = 'work'), 'retry: same reference');
select pg_temp.expect((select inspiration = 'fitzwilliam-office'
  from pg_temp.reference((select value from res where name = 'work'))), 'retry changes nothing');
select pg_temp.expect((select inspiration is null and form_version = 2
  from pg_temp.reference((select value from res where name = 'old'))), 'old pages: no inspiration');
select pg_temp.expect((select inspiration is null
  from pg_temp.reference((select value from res where name = 'blank'))), 'blank is none');
-- The column refuses anything but a slug, whoever writes it.
select pg_temp.expect_error(format('update public.enquiries set inspiration = %L where id = %L',
  'Not A Slug', (pg_temp.reference((select value from res where name = 'work'))).id), '23514');

rollback;
