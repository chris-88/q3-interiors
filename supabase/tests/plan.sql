-- The job plan (stages, materials, product list, tradespeople): staff-only access, the write
-- functions' rules, the price snapshot, and the plan going with its enquiry. One transaction,
-- always rolled back.
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

create function pg_temp.enquiry(p_key text, p_type text) returns uuid language plpgsql as $$
declare v jsonb;
begin
  v := public.submit_enquiry_with_access(p_key::uuid, 'enquiry', 2,
    jsonb_build_object('appointment_preference', 'on_site', 'project_type', p_type,
      'location', 'Dublin 8', 'name', 'Plan Person', 'email', 'plan@example.invalid',
      'phone', '087 123 4567', 'site_street', '1 Test Street'));
  return (select id from public.enquiries where reference = v ->> 'reference');
end;
$$;
create function pg_temp.id(p text) returns uuid language sql as $$
  select (value #>> '{}')::uuid from r where name = p
$$;

insert into auth.users (id, aud, role, email) values
  ('00000000-0000-4000-8000-000000000eb1', 'authenticated', 'authenticated', 'planstaff@example.invalid'),
  ('00000000-0000-4000-8000-000000000eb2', 'authenticated', 'authenticated', 'planoff@example.invalid'),
  ('00000000-0000-4000-8000-000000000eb3', 'authenticated', 'authenticated', 'planout@example.invalid');
select private.add_staff('00000000-0000-4000-8000-000000000eb1', 'planstaff@example.invalid', 'Plan Staff', 'staff');
select private.add_staff('00000000-0000-4000-8000-000000000eb2', 'planoff@example.invalid', 'Plan Off', 'staff');
select private.set_staff_active('00000000-0000-4000-8000-000000000eb2', false);

insert into r values
  ('won', to_jsonb(pg_temp.enquiry('00000000-0000-4000-8000-000000000ea1', 'bathroom'))),
  ('open', to_jsonb(pg_temp.enquiry('00000000-0000-4000-8000-000000000ea2', 'kitchen'))),
  ('odd', to_jsonb(pg_temp.enquiry('00000000-0000-4000-8000-000000000ea3', 'whole_home')));
update public.enquiries set outcome = 'won', outcome_at = now(), won_date = current_date, outcome_value = 9000
where id in (pg_temp.id('won'), pg_temp.id('odd'));

-- The templates: every job type has a list, plus the any-job one.
select pg_temp.expect((select count(distinct coalesce(project_type, '')) from public.stage_templates) = 6,
  'templates for five job types and any job');

-- Access: anon nothing; the anon function list is unchanged (five).
select pg_temp.expect(
  (select array_agg(p.proname::text order by p.proname)
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'private') and has_function_privilege('anon', p.oid, 'execute'))
  = array['public_appointment_types', 'public_business_details', 'public_wording',
          'record_visit', 'submit_enquiry_with_access'],
  'anon may run only the five public functions');
set local role anon;
select pg_temp.expect_error('select * from public.job_stages', '42501');
select pg_temp.expect_error('select * from public.job_materials', '42501');
select pg_temp.expect_error('select * from public.products', '42501');
select pg_temp.expect_error('select * from public.tradespeople', '42501');
select pg_temp.expect_error('select * from public.stage_templates', '42501');
select pg_temp.expect_error(format('select public.start_job_plan(%L)', pg_temp.id('won')), '42501');
select pg_temp.expect_error('select public.add_product(''Anon product'', ''each'', 100, null)', '42501');
reset role;

-- Someone signed in but not staff, or switched off: nothing.
set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-000000000eb3');
select pg_temp.expect((select count(*) = 0 from public.stage_templates), 'outsider reads no templates');
select pg_temp.expect_error(format('select public.start_job_plan(%L)', pg_temp.id('won')), '42501');
select pg_temp.as_user('00000000-0000-4000-8000-000000000eb2');
select pg_temp.expect_error(format('select public.start_job_plan(%L)', pg_temp.id('won')), '42501');
select pg_temp.expect_error('select public.add_tradesperson(''Off Person'', null, null)', '42501');

-- Staff: a plan only on a won job; from the job type's template, once.
select pg_temp.as_user('00000000-0000-4000-8000-000000000eb1');
select pg_temp.expect_error(format('select public.start_job_plan(%L)', pg_temp.id('open')), '22023');
select pg_temp.expect(public.start_job_plan(pg_temp.id('won')) = 8, 'bathroom plan: eight stages');
select pg_temp.expect(public.start_job_plan(pg_temp.id('won')) = 8, 'starting again changes nothing');
select pg_temp.expect((select array_agg(name order by position) from public.job_stages where enquiry_id = pg_temp.id('won'))
  = array['Strip out', 'First fix plumbing', 'First fix electrics', 'Plastering and boarding', 'Tiling',
          'Sanitaryware', 'Second fix', 'Painting and finish'], 'in the template order');
select pg_temp.expect(public.start_job_plan(pg_temp.id('odd')) = 6, 'a job type with no list starts from any job');
select pg_temp.expect((select count(*) = 1 from public.enquiry_events
  where enquiry_id = pg_temp.id('won') and kind = 'plan_started' and actor_name = 'Plan Staff'), 'plan_started in the history');
select pg_temp.expect_error('insert into public.job_stages (enquiry_id, name, position) values (gen_random_uuid(), ''x'', 1)', '42501');

-- Stages: add, rename, move, done, remove.
insert into r values ('extra', to_jsonb(public.add_job_stage(pg_temp.id('won'), '  Snag   list ')));
select pg_temp.expect((select name = 'Snag list' and position = 9 from public.job_stages where id = pg_temp.id('extra')), 'added last, tidied');
select pg_temp.expect_error(format('select public.add_job_stage(%L, ''x'')', pg_temp.id('open')), '22023');
select pg_temp.expect_error(format('select public.add_job_stage(%L, ''  '')', pg_temp.id('won')), '22023');
select public.rename_job_stage(pg_temp.id('extra'), 'Snagging');
select public.move_job_stage(pg_temp.id('extra'), -1);
select pg_temp.expect((select array_agg(name order by position) from public.job_stages where enquiry_id = pg_temp.id('won'))
  [8:9] = array['Snagging', 'Painting and finish'], 'moved up one');
select public.move_job_stage((select id from public.job_stages where enquiry_id = pg_temp.id('won') and position = 1), -1);
select pg_temp.expect((select name = 'Strip out' from public.job_stages where enquiry_id = pg_temp.id('won') and position = 1),
  'the first stays first');
insert into r select 'strip', to_jsonb(id) from public.job_stages where enquiry_id = pg_temp.id('won') and name = 'Strip out';
select public.set_job_stage_done(pg_temp.id('strip'), true);
select public.set_job_stage_done(pg_temp.id('strip'), true);
select pg_temp.expect((select count(*) = 1 from public.enquiry_events
  where enquiry_id = pg_temp.id('won') and kind = 'stage_done' and detail = 'Strip out done'), 'one stage_done line');
select public.set_job_stage_done(pg_temp.id('strip'), false);
select pg_temp.expect((select done_at is null from public.job_stages where id = pg_temp.id('strip')), 'undone');

-- Tradespeople: one per name in any case; given to a stage; archiving keeps the stage's.
insert into r values ('tom', to_jsonb(public.add_tradesperson(' Tom   Sample ', 'Plumber', '087 000 0000')));
select pg_temp.expect(public.add_tradesperson('tom sample', null, null) = pg_temp.id('tom'), 'same person, any case');
select pg_temp.expect((select trade = 'Plumber' from public.tradespeople where id = pg_temp.id('tom')), 'details kept');
select public.set_job_stage_tradesperson(pg_temp.id('strip'), pg_temp.id('tom'));
select public.archive_tradesperson(pg_temp.id('tom'), true);
select pg_temp.expect((select tradesperson_id = pg_temp.id('tom') from public.job_stages where id = pg_temp.id('strip')),
  'archived, still on the stage');
select public.archive_tradesperson(pg_temp.id('tom'), false);
select public.update_tradesperson(pg_temp.id('tom'), 'Tom Sample', 'Plumber and heating', null);
select pg_temp.expect((select trade = 'Plumber and heating' and phone is null from public.tradespeople where id = pg_temp.id('tom')), 'edited');
select pg_temp.expect_error('select public.set_job_stage_tradesperson(''00000000-0000-4000-8000-00000000dead'', null)', 'P0002');
select pg_temp.expect_error(format('select public.add_tradesperson(%L, null, null)', repeat('x', 81)), '22023');

-- Products and lines: a line snapshots the product; a new usual price changes future lines only.
insert into r values ('tile', to_jsonb(public.add_product(' Wall tile  white ', 'm2', 2450, 'Tile Shop')));
select pg_temp.expect(public.add_product('WALL TILE WHITE', 'each', 1, null) = pg_temp.id('tile'), 'same product, any case');
select pg_temp.expect((select price_cents = 2450 and unit = 'm2' from public.products where id = pg_temp.id('tile')),
  'adding again keeps the usual price');
insert into r select 'tiling', to_jsonb(id) from public.job_stages where enquiry_id = pg_temp.id('won') and name = 'Tiling';
insert into r values ('line1', to_jsonb(public.add_job_material(pg_temp.id('tiling'), pg_temp.id('tile'), 12.5)));
select pg_temp.expect((select name = 'Wall tile white' and unit = 'm2' and price_cents = 2450 and quantity = 12.5
  and enquiry_id = pg_temp.id('won') from public.job_materials where id = pg_temp.id('line1')), 'prefilled from the product');
select public.update_product(pg_temp.id('tile'), 'Wall tile white', 'm2', 2600, 'Tile Shop');
insert into r values ('line2', to_jsonb(public.add_job_material(pg_temp.id('strip'), pg_temp.id('tile'), 1, null, null)));
select pg_temp.expect((select price_cents from public.job_materials where id = pg_temp.id('line1')) = 2450,
  'the planned line keeps its price');
select pg_temp.expect((select price_cents from public.job_materials where id = pg_temp.id('line2')) = 2600,
  'a new line takes the new usual price');
select public.update_job_material(pg_temp.id('line1'), 14, 'm2', 2500);
select pg_temp.expect((select quantity = 14 and price_cents = 2500 from public.job_materials where id = pg_temp.id('line1')),
  'line edited');
select public.set_job_material_got(pg_temp.id('line1'), true);
select pg_temp.expect((select got_at is not null from public.job_materials where id = pg_temp.id('line1')), 'got it');
select public.set_job_material_got(pg_temp.id('line1'), false);
select pg_temp.expect_error(format('select public.update_job_material(%L, 0, ''m2'', 100)', pg_temp.id('line1')), '22023');
select pg_temp.expect_error(format('select public.add_job_material(%L, %L, -1)', pg_temp.id('tiling'), pg_temp.id('tile')), '22023');
select pg_temp.expect_error('select public.add_product(''x'', ''each'', 100, null)', '22023');
select pg_temp.expect_error('select public.add_product(''Too dear'', ''each'', 100000001, null)', '22023');
select public.archive_product(pg_temp.id('tile'), true);
select pg_temp.expect((select count(*) = 2 from public.job_materials where product_id = pg_temp.id('tile')),
  'archiving a product leaves the lines');
select public.remove_job_material(pg_temp.id('line2'));
select pg_temp.expect_error(format('select public.remove_job_material(%L)', pg_temp.id('line2')), 'P0002');
select pg_temp.expect_error('update public.products set price_cents = 1', '42501');

-- Removing a stage takes its lines.
select public.remove_job_stage(pg_temp.id('tiling'));
select pg_temp.expect(not exists (select 1 from public.job_materials where id = pg_temp.id('line1')), 'lines go with the stage');
reset role;

-- The plan goes with the enquiry (retention and data requests both use delete_enquiry_data); the
-- product list and the tradespeople stay.
insert into r values ('line3', to_jsonb((select id from public.job_materials where enquiry_id = pg_temp.id('won') limit 1)));
select private.delete_enquiry_data(pg_temp.id('won'), 'staff_request', 'Plan Staff');
select private.delete_enquiry_data(pg_temp.id('odd'), 'retention', null);
select pg_temp.expect(not exists (select 1 from public.job_stages where enquiry_id in (pg_temp.id('won'), pg_temp.id('odd'))),
  'stages deleted with the enquiry');
select pg_temp.expect(not exists (select 1 from public.job_materials where enquiry_id = pg_temp.id('won')),
  'lines deleted with the enquiry');
select pg_temp.expect(exists (select 1 from public.products where id = pg_temp.id('tile'))
  and exists (select 1 from public.tradespeople where id = pg_temp.id('tom')), 'lists kept');

select 'plan checks passed';
rollback;
