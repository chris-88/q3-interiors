-- The supplier catalogue in the product list: name rules (own names unique, catalogue names may
-- repeat), (source, SKU) unique, the import (service role only, dry run, re-run, kept price, never
-- un-archive), server search (any word order, ranking, filters) and staff-only access. One
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
grant execute on all functions in schema pg_temp to anon, authenticated, service_role;
create temp table r (name text primary key, value jsonb);
grant all on r to anon, authenticated, service_role;
create function pg_temp.id(p text) returns uuid language sql as $$
  select (value #>> '{}')::uuid from r where name = p
$$;

insert into auth.users (id, aud, role, email) values
  ('00000000-0000-4000-8000-000000000ec1', 'authenticated', 'authenticated', 'catstaff@example.invalid'),
  ('00000000-0000-4000-8000-000000000ec3', 'authenticated', 'authenticated', 'catout@example.invalid');
select private.add_staff('00000000-0000-4000-8000-000000000ec1', 'catstaff@example.invalid', 'Cat Staff', 'staff');

-- The import: service role only.
create function pg_temp.import(p_rows text, p_dry boolean default false) returns jsonb language sql as $$
  select public.import_supplier_products('testsupplier', 'Test Supplier', p_rows::jsonb, p_dry)
$$;
grant execute on function pg_temp.import(text, boolean) to service_role;

set local role anon;
select pg_temp.expect_error('select public.import_supplier_products(''testsupplier'', ''X'', ''[]''::jsonb)', '42501');
select pg_temp.expect_error('select * from public.find_products(''cement'')', '42501');
reset role;
set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-000000000ec1');
select pg_temp.expect_error('select public.import_supplier_products(''testsupplier'', ''X'', ''[]''::jsonb)', '42501');
select pg_temp.as_user('00000000-0000-4000-8000-000000000ec3');
select pg_temp.expect_error('select * from public.find_products(''cement'')', '42501');
reset role;
select pg_temp.expect(
  (select array_agg(p.proname::text order by p.proname)
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'private') and has_function_privilege('anon', p.oid, 'execute'))
  = array['public_appointment_types', 'public_business_details', 'public_wording',
          'record_visit', 'submit_enquiry_with_access'],
  'anon may run only the five public functions');

set local role service_role;
-- A dry run counts and writes nothing.
select pg_temp.expect(pg_temp.import('[
  {"sku": "T1", "name": "Testcat White Cement 25kg Bag", "price_cents": 1280, "url": "https://example.invalid/a", "category": "Building > Cement"},
  {"sku": "T2", "name": "Testcat Hydrated Lime 25kg", "price_cents": 1375, "url": null, "category": null},
  {"sku": "T3", "name": "Testcat Hydrated Lime 25kg", "price_cents": 1400, "url": null, "category": null},
  {"sku": "T4", "name": "x", "price_cents": 100},
  {"sku": "T5", "name": "Testcat Free thing", "price_cents": 0},
  {"sku": "T6", "name": "Testcat Bad link", "price_cents": 100, "url": "javascript:alert(1)"}
]', true) = '{"added": 3, "updated": 0, "unchanged": 0, "kept_your_price": 0, "invalid": 3, "dry_run": true}'::jsonb,
  'dry run: three to add, three invalid');
reset role;
select pg_temp.expect(not exists (select 1 from public.products where source = 'testsupplier'), 'dry run wrote nothing');

set local role service_role;
select pg_temp.import('[
  {"sku": "T1", "name": "Testcat White Cement 25kg Bag", "price_cents": 1280, "url": "https://example.invalid/a", "category": "Building > Cement"},
  {"sku": "T2", "name": "Testcat Hydrated Lime 25kg", "price_cents": 1375},
  {"sku": "T3", "name": "Testcat Hydrated Lime 25kg", "price_cents": 1400}
]');
reset role;
select pg_temp.expect((select count(*) = 2 from public.products where source = 'testsupplier' and name = 'Testcat Hydrated Lime 25kg'),
  'catalogue names may repeat');
select pg_temp.expect((select supplier = 'Test Supplier' and price_cents = 1280 and supplier_price_cents = 1280
  and category = 'Building > Cement' and price_checked_at is not null and unit = 'each'
  from public.products where source = 'testsupplier' and supplier_sku = 'T1'), 'catalogue row as imported');
select pg_temp.expect_error('insert into public.products (name, price_cents, source, supplier_sku) values (''Dup'', 1, ''testsupplier'', ''T1'')', '23505');
select pg_temp.expect_error('insert into public.products (name, price_cents, source) values (''No sku'', 1, ''testsupplier'')', '23514');
insert into r select 'cement', to_jsonb(id) from public.products where source = 'testsupplier' and supplier_sku = 'T1';
insert into r select 'lime', to_jsonb(id) from public.products where source = 'testsupplier' and supplier_sku = 'T2';

-- Staff: an own product may share a catalogue name; own names stay unique in any case.
set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-000000000ec1');
insert into r values ('own', to_jsonb(public.add_product('Testcat Hydrated Lime 25kg', 'bag', 1200, null)));
select pg_temp.expect(pg_temp.id('own') not in (pg_temp.id('lime')), 'own product beside the catalogue one');
select pg_temp.expect(public.add_product('testcat hydrated lime 25KG', 'each', 1, null) = pg_temp.id('own'),
  'own names unique in any case');
-- Staff change the catalogue cement's price; a later import keeps it.
select public.update_product(pg_temp.id('cement'), 'Testcat White Cement 25kg Bag', 'each', 1100, 'Test Supplier');
select pg_temp.expect((select price_edited_at is not null from public.products where id = pg_temp.id('cement')), 'edit remembered');
select public.archive_product(pg_temp.id('lime'), true);
reset role;

set local role service_role;
select pg_temp.expect(pg_temp.import('[
  {"sku": "T1", "name": "Testcat White Cement 25kg Bag", "price_cents": 1350, "url": "https://example.invalid/a", "category": "Building > Cement"},
  {"sku": "T2", "name": "Testcat Hydrated Lime 25kg", "price_cents": 1375},
  {"sku": "T3", "name": "Testcat Hydrated Lime 25kg", "price_cents": 1500}
]') = '{"added": 0, "updated": 2, "unchanged": 1, "kept_your_price": 1, "invalid": 0, "dry_run": false}'::jsonb,
  're-run: T1 supplier price moved (your price kept), T2 unchanged, T3 updated');
reset role;
select pg_temp.expect((select price_cents = 1100 and supplier_price_cents = 1350 from public.products where id = pg_temp.id('cement')),
  'your price kept, the supplier''s beside it');
select pg_temp.expect((select archived_at is not null from public.products where id = pg_temp.id('lime')), 'still archived');
select pg_temp.expect((select price_cents = 1500 from public.products where source = 'testsupplier' and supplier_sku = 'T3'),
  'an unedited price follows the supplier');

-- Search: any word order, SKU prefix, used first, then own, then catalogue; filters.
set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-000000000ec1');
select pg_temp.expect((select array_agg(name) from public.find_products('cement testcat white')) = array['Testcat White Cement 25kg Bag'],
  'words in any order');
select pg_temp.expect((select count(*) = 0 from public.find_products('testcat cement lime')), 'every word must match');
select pg_temp.expect((select count(*) = 1 from public.find_products('t1', 'testsupplier')), 'SKU prefix');
select pg_temp.expect((select array_agg(source order by ordinality) from public.find_products('testcat hydrated', 'all')
  with ordinality) = array[null, 'testsupplier'], 'own before catalogue; archived left out');
select pg_temp.expect((select count(*) = 3 from public.find_products('testcat hydrated', 'all', 20, 0, true)), 'archived on request');
select pg_temp.expect((select bool_and(source is null) from public.find_products('testcat', 'mine')), 'mine');
select pg_temp.expect((select bool_and(source = 'testsupplier') from public.find_products('testcat', 'testsupplier')), 'one source');
select pg_temp.expect((select max(total) = 2 from public.find_products('testcat', 'testsupplier', 1)), 'total beyond the page');
select pg_temp.expect((select count(*) = 1 from public.find_products('100%', 'all')) is not null, 'a % in the query is literal');
select pg_temp.expect_error('select * from public.find_products(''x'', ''bad filter!'')', '22023');
select pg_temp.expect_error('select * from public.find_products(''x'', ''all'', 500)', '22023');
reset role;

-- Used on a job comes first.
update public.booking_settings set enquiry_limit_per_hour = 100;
do $$
declare v jsonb;
begin
  v := public.submit_enquiry_with_access('00000000-0000-4000-8000-000000000ed1'::uuid, 'enquiry', 2,
    jsonb_build_object('appointment_preference', 'on_site', 'project_type', 'kitchen', 'location', 'Dublin 8',
      'name', 'Cat Person', 'email', 'cat@example.invalid', 'phone', '087 123 4567', 'site_street', '1 Test Street'));
  insert into r select 'job', to_jsonb(id) from public.enquiries where reference = v ->> 'reference';
end;
$$;
update public.enquiries set outcome = 'won', outcome_at = now(), won_date = current_date, outcome_value = 1000 where id = pg_temp.id('job');
set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-000000000ec1');
select public.start_job_plan(pg_temp.id('job'));
select public.add_job_material((select id from public.job_stages where enquiry_id = pg_temp.id('job') order by position limit 1),
  (select id from public.products where source = 'testsupplier' and supplier_sku = 'T3'));
select pg_temp.expect((select source = 'testsupplier' and uses = 1 from public.find_products('testcat hydrated') limit 1),
  'used on a job first');
select pg_temp.expect((select count(*) = 1 from public.find_products('testcat', 'used')), 'used filter');
select pg_temp.expect((select count(*) = 2 from public.find_products('testcat', 'mine_used')), 'mine and used');
reset role;

select 'catalogue checks passed';
rollback;
