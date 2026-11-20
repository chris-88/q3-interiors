-- Access and behaviour checks for slice 1, run against a real database inside one transaction
-- that is always rolled back: nothing it creates survives. Run with `npm run test:db`.
-- Any failed expectation raises and psql exits non-zero (ON_ERROR_STOP).
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

create temp table results (name text primary key, value text);
grant all on results to anon, authenticated;

-- A valid set of answers for enquiry v1, reused below.
create function pg_temp.valid_answers() returns jsonb language sql as $$
  select '{
    "project_type": "kitchen",
    "description": "Replace the kitchen units and worktops.",
    "location": "D07 X2Y3",
    "timing": "flexible",
    "name": "Test Person",
    "email": "test@example.com",
    "phone": "087 123 4567"
  }'::jsonb
$$;

-- -------------------------------------------------------------------------------------------
-- anon: no table access at all, only submit_enquiry
-- -------------------------------------------------------------------------------------------
set local role anon;

select pg_temp.expect_error('select * from public.enquiries', '42501');
select pg_temp.expect_error('update public.enquiries set status = ''contacted''', '42501');
select pg_temp.expect_error('delete from public.enquiries', '42501');
select pg_temp.expect_error('insert into public.enquiries (reference) values (''Q3-AAAAAA'')', '42501');
select pg_temp.expect_error('select * from public.form_versions', '42501');
select pg_temp.expect_error('select * from public.staff', '42501');
select pg_temp.expect_error('select * from public.enquiry_revisions', '42501');
select pg_temp.expect_error('select * from public.enquiry_attribution', '42501');
select pg_temp.expect_error('select * from public.enquiry_events', '42501');
select pg_temp.expect_error('select public.is_staff()', '42501');
select pg_temp.expect_error(
  'select public.set_enquiry_status(gen_random_uuid(), ''contacted'', null)', '42501');
select pg_temp.expect_error(
  'select public.publish_form_version(''enquiry'', 99, ''{}''::jsonb)', '42501');

-- Submission and idempotency: the same key twice yields the same reference.
insert into results values ('ref1', public.submit_enquiry(
  '00000000-0000-4000-8000-000000000001', 'enquiry', 1, pg_temp.valid_answers(), true,
  '{"utm_source": "instagram", "utm_medium": "paid_social", "utm_campaign": "kitchens",
    "click_id_present": true, "landing_path": "/", "first_seen_at": "2026-11-20T10:00:00Z"}'::jsonb));
insert into results values ('ref1_again', public.submit_enquiry(
  '00000000-0000-4000-8000-000000000001', 'enquiry', 1, pg_temp.valid_answers(), true, null));
select pg_temp.expect(
  (select value from results where name = 'ref1') = (select value from results where name = 'ref1_again'),
  'a repeated idempotency key returns the same reference');
select pg_temp.expect((select value from results where name = 'ref1') ~ '^Q3-[A-Z0-9]{6}$',
  'reference format');

-- No attribution at all is stored as unknown.
insert into results values ('ref_untracked', public.submit_enquiry(
  '00000000-0000-4000-8000-000000000002', 'enquiry', 1, pg_temp.valid_answers(), false, null));

-- A hidden conditional answer is dropped, not stored.
insert into results values ('ref_hidden', public.submit_enquiry(
  '00000000-0000-4000-8000-000000000003', 'enquiry', 1,
  pg_temp.valid_answers() || '{"rooms": ["kitchen"], "project_type_other": "x"}'::jsonb, false, null));

-- Server-side validation.
select pg_temp.expect_error(format('select public.submit_enquiry(%L, ''enquiry'', 1, %L)',
  gen_random_uuid(), pg_temp.valid_answers() - 'email'), '22023');
select pg_temp.expect_error(format('select public.submit_enquiry(%L, ''enquiry'', 1, %L)',
  gen_random_uuid(), pg_temp.valid_answers() || '{"email": "not-an-email"}'), '22023');
select pg_temp.expect_error(format('select public.submit_enquiry(%L, ''enquiry'', 1, %L)',
  gen_random_uuid(), pg_temp.valid_answers() || '{"phone": "12"}'), '22023');
select pg_temp.expect_error(format('select public.submit_enquiry(%L, ''enquiry'', 1, %L)',
  gen_random_uuid(), pg_temp.valid_answers() || '{"timing": "yesterday"}'), '22023');
select pg_temp.expect_error(format('select public.submit_enquiry(%L, ''enquiry'', 1, %L)',
  gen_random_uuid(), pg_temp.valid_answers() || '{"surprise": "x"}'), '22023');
select pg_temp.expect_error(format('select public.submit_enquiry(%L, ''enquiry'', 1, %L)',
  gen_random_uuid(), pg_temp.valid_answers() || '{"project_type": "whole_home"}'), '22023');
select pg_temp.expect_error(format('select public.submit_enquiry(%L, ''enquiry'', 1, %L)',
  gen_random_uuid(), pg_temp.valid_answers() || '{"project_type": "whole_home", "rooms": ["kitchen", "kitchen"]}'),
  '22023');
select pg_temp.expect_error(format('select public.submit_enquiry(%L, ''enquiry'', 99, %L)',
  gen_random_uuid(), pg_temp.valid_answers()), '22023');
select pg_temp.expect_error(format('select public.submit_enquiry(null, ''enquiry'', 1, %L)',
  pg_temp.valid_answers()), '22023');

reset role;

-- -------------------------------------------------------------------------------------------
-- What was stored (as the owner)
-- -------------------------------------------------------------------------------------------
select pg_temp.expect(
  (select count(*) from public.enquiries where idempotency_key = '00000000-0000-4000-8000-000000000001') = 1,
  'one row for a repeated idempotency key');
select pg_temp.expect(
  (select count(*) from public.enquiry_revisions r join public.enquiries e on e.id = r.enquiry_id
   where e.idempotency_key = '00000000-0000-4000-8000-000000000001') = 1,
  'one revision for a repeated idempotency key');
select pg_temp.expect(
  (select a.tracking = 'tagged' and a.utm_source = 'instagram' and a.click_id_present and a.utm_term is null
   from public.enquiry_attribution a join public.enquiries e on e.id = a.enquiry_id
   where e.idempotency_key = '00000000-0000-4000-8000-000000000001'),
  'attribution stored as given, missing values null');
select pg_temp.expect(
  (select a.tracking = 'unknown' and a.utm_source is null and a.click_id_present is null
   from public.enquiry_attribution a join public.enquiries e on e.id = a.enquiry_id
   where e.idempotency_key = '00000000-0000-4000-8000-000000000002'),
  'missing attribution stored as unknown');
select pg_temp.expect(
  (select not (answers ? 'rooms') and not (answers ? 'project_type_other')
   from public.enquiries where idempotency_key = '00000000-0000-4000-8000-000000000003'),
  'hidden answers dropped');
select pg_temp.expect(
  (select marketing_opt_in and marketing_opt_in_at is not null and not (answers ? 'marketing_opt_in')
   from public.enquiries where idempotency_key = '00000000-0000-4000-8000-000000000001'),
  'marketing preference recorded separately');
select pg_temp.expect_error('update public.form_versions set published_at = now()', '55000');
select pg_temp.expect_error('delete from public.form_versions', '55000');

-- -------------------------------------------------------------------------------------------
-- Signed-in users: a non-staff user sees nothing; staff see everything and change status.
-- -------------------------------------------------------------------------------------------
insert into auth.users (id, aud, role, email)
values ('00000000-0000-4000-8000-0000000000a1', 'authenticated', 'authenticated', 'outsider@example.invalid'),
       ('00000000-0000-4000-8000-0000000000a2', 'authenticated', 'authenticated', 'staff@example.invalid');
insert into public.staff (user_id, role, display_name)
values ('00000000-0000-4000-8000-0000000000a2', 'staff', 'Test Staff');
insert into results
select 'enquiry1', id::text from public.enquiries
where idempotency_key = '00000000-0000-4000-8000-000000000001';

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-8000-0000000000a1", "role": "authenticated"}', true);
select pg_temp.expect((select count(*) from public.enquiries) = 0, 'non-staff sees no enquiries');
select pg_temp.expect((select count(*) from public.form_versions) = 0, 'non-staff sees no form versions');
select pg_temp.expect((select count(*) from public.enquiry_events) = 0, 'non-staff sees no events');
select pg_temp.expect((select count(*) from public.staff) = 0, 'non-staff sees no staff rows');
select pg_temp.expect_error('update public.enquiries set status = ''contacted''', '42501');
select pg_temp.expect_error(format('select public.set_enquiry_status(%L, ''contacted'', null)',
  (select value from results where name = 'enquiry1')), '42501');

select set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-8000-0000000000a2", "role": "authenticated"}', true);
select pg_temp.expect((select count(*) from public.enquiries) >= 3, 'staff see enquiries');
select pg_temp.expect((select count(*) from public.form_versions) >= 1, 'staff see form versions');
select pg_temp.expect_error('update public.enquiries set status = ''contacted''', '42501');
select pg_temp.expect_error(format('select public.set_enquiry_status(%L, ''unsuitable'', ''  '')',
  (select value from results where name = 'enquiry1')), '22023');
select public.set_enquiry_status((select value from results where name = 'enquiry1')::uuid, 'in_review', null);
select public.set_enquiry_status((select value from results where name = 'enquiry1')::uuid, 'unsuitable', 'Outside the service area');
select pg_temp.expect(
  (select status = 'unsuitable' and status_reason = 'Outside the service area'
   from public.enquiries where id = (select value from results where name = 'enquiry1')::uuid),
  'status and reason updated');
select pg_temp.expect(
  (select count(*) from public.enquiry_events
   where enquiry_id = (select value from results where name = 'enquiry1')::uuid) = 3,
  'submitted event plus two status changes');
select pg_temp.expect(
  (select actor_name = 'Test Staff' and from_status = 'in_review' and reason = 'Outside the service area'
   from public.enquiry_events
   where enquiry_id = (select value from results where name = 'enquiry1')::uuid and to_status = 'unsuitable'),
  'event records actor, from status and reason');

reset role;
select 'access checks passed' as result;
rollback;
