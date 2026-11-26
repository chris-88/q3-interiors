-- Slice 7: outcomes after the appointment (quoted, won, lost). One transaction, always rolled back.
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
      "name": "Test Person", "email": "outcome@example.invalid", "phone": "087 123 4567"}'::jsonb);
  return (select id from public.enquiries where reference = v ->> 'reference');
end;
$$;
insert into r values ('a', to_jsonb(pg_temp.enquiry('00000000-0000-4000-8000-0000000007a1')));
insert into r values ('b', to_jsonb(pg_temp.enquiry('00000000-0000-4000-8000-0000000007a2')));
create function pg_temp.id(p text) returns uuid language sql as $$
  select (value #>> '{}')::uuid from r where name = p
$$;
create function pg_temp.e(p text) returns public.enquiries language sql as $$
  select * from public.enquiries where id = pg_temp.id(p)
$$;

insert into auth.users (id, aud, role, email) values
  ('00000000-0000-4000-8000-0000000007b1', 'authenticated', 'authenticated', 'staffo@example.invalid'),
  ('00000000-0000-4000-8000-0000000007b2', 'authenticated', 'authenticated', 'offo@example.invalid'),
  ('00000000-0000-4000-8000-0000000007b3', 'authenticated', 'authenticated', 'outsidero@example.invalid');
select private.add_staff('00000000-0000-4000-8000-0000000007b1', 'staffo@example.invalid', 'Staff O', 'staff');
select private.add_staff('00000000-0000-4000-8000-0000000007b2', 'offo@example.invalid', 'Off O', 'staff');
select private.set_staff_active('00000000-0000-4000-8000-0000000007b2', false);

-- -------------------------------------------------------------------------------------------
-- Access: anon cannot call it, read the columns or change them; only active staff write
-- -------------------------------------------------------------------------------------------
set local role anon;
select pg_temp.expect_error(format('select public.record_enquiry_outcome(%L, ''quoted'', 1000, current_date)',
  pg_temp.id('a')), '42501');
select pg_temp.expect_error('select outcome, quote_amount from public.enquiries', '42501');
select pg_temp.expect_error('update public.enquiries set outcome = ''won''', '42501');
reset role;
-- The anon list is still exactly the five.
select pg_temp.expect(
  (select array_agg(p.proname::text order by p.proname)
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'private') and has_function_privilege('anon', p.oid, 'execute'))
  = array['public_appointment_types', 'public_business_details', 'public_wording',
          'record_visit', 'submit_enquiry_with_access'],
  'anon may run only the five public functions');

set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-0000000007b3');
select pg_temp.expect_error(format('select public.record_enquiry_outcome(%L, ''quoted'', 1000, current_date)',
  pg_temp.id('a')), '42501');
select pg_temp.as_user('00000000-0000-4000-8000-0000000007b2');
select pg_temp.expect_error(format('select public.record_enquiry_outcome(%L, ''quoted'', 1000, current_date)',
  pg_temp.id('a')), '42501');

-- -------------------------------------------------------------------------------------------
-- Stages, validation, history
-- -------------------------------------------------------------------------------------------
select pg_temp.as_user('00000000-0000-4000-8000-0000000007b1');
select pg_temp.expect_error(format('select public.record_enquiry_outcome(%L, ''quoted'', null, current_date)', pg_temp.id('a')), '22023');
select pg_temp.expect_error(format('select public.record_enquiry_outcome(%L, ''quoted'', -5, current_date)', pg_temp.id('a')), '22023');
select pg_temp.expect_error(format('select public.record_enquiry_outcome(%L, ''quoted'', 1000, null)', pg_temp.id('a')), '22023');
select pg_temp.expect_error(format('select public.record_enquiry_outcome(%L, ''quoted'', 1000, current_date + 30)', pg_temp.id('a')), '22023');
select pg_temp.expect_error(format('select public.record_enquiry_outcome(%L, ''won'', null, current_date)', pg_temp.id('a')), '22023');
select pg_temp.expect_error(format('select public.record_enquiry_outcome(%L, ''lost'')', pg_temp.id('a')), '22023');
select pg_temp.expect_error(format('select public.record_enquiry_outcome(%L, ''lost'', null, null, ''other'')', pg_temp.id('a')), '22023');
select pg_temp.expect_error(format('select public.record_enquiry_outcome(%L, ''lost'', 10, null, ''price'')', pg_temp.id('a')), '22023');
select pg_temp.expect_error(format('select public.record_enquiry_outcome(%L, ''paused'')', pg_temp.id('a')), '22023');

select public.record_enquiry_outcome(pg_temp.id('a'), 'quoted', 18450.5, date '2026-11-20', null, 'Kitchen and utility');
reset role;
select pg_temp.expect((select outcome = 'quoted' and quote_amount = 18450.50 and quote_date = date '2026-11-20'
  from pg_temp.e('a')), 'quoted with amount and date');

set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-0000000007b1');
select public.record_enquiry_outcome(pg_temp.id('a'), 'won', 17900, date '2026-11-24');
reset role;
select pg_temp.expect((select outcome = 'won' and outcome_value = 17900 and won_date = date '2026-11-24'
  and quote_amount = 18450.50 from pg_temp.e('a')), 'won keeps the quote');

-- Correct the win (a different value), then move back to quoted, then lost; finally clear.
set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-0000000007b1');
select public.record_enquiry_outcome(pg_temp.id('a'), 'won', 18000, date '2026-11-25');
select public.record_enquiry_outcome(pg_temp.id('b'), 'lost', null, null, 'not_a_fit', null);
select public.record_enquiry_outcome(pg_temp.id('b'), 'lost', null, null, 'other', 'Moving abroad');
reset role;
select pg_temp.expect((select outcome_value = 18000 and won_date = date '2026-11-25' from pg_temp.e('a')), 'win corrected');
select pg_temp.expect((select outcome = 'lost' and outcome_reason = 'other' and outcome_note = 'Moving abroad'
  and outcome_value is null from pg_temp.e('b')), 'lost with reason and note');
select pg_temp.expect(
  (select array_agg(detail order by id) from public.enquiry_events
   where enquiry_id = pg_temp.id('a') and kind = 'outcome_recorded')
  = array['Quoted €18,450.50 on 20 Nov 2026. Kitchen and utility',
          'Won €17,900.00 on 24 Nov 2026 (was quoted)',
          'Won €18,000.00 on 25 Nov 2026 (was won)'],
  'every change in the history, worded');
select pg_temp.expect((select bool_and(actor_name = 'Staff O') from public.enquiry_events
  where enquiry_id = pg_temp.id('a') and kind = 'outcome_recorded'), 'who is recorded');

set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-0000000007b1');
select public.record_enquiry_outcome(pg_temp.id('b'), 'none');
reset role;
select pg_temp.expect((select outcome is null and outcome_reason is null and quote_amount is null
  from pg_temp.e('b')), 'cleared');
select pg_temp.expect(exists (select 1 from public.enquiry_events
  where enquiry_id = pg_temp.id('b') and kind = 'outcome_cleared'), 'clearing is in the history');

-- The slice 3 entry point (older open consoles) still works through the same writer.
set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-0000000007b1');
select public.set_enquiry_outcome(pg_temp.id('b'), 'won');
reset role;
select pg_temp.expect((select outcome = 'won' and outcome_value is null and won_date is not null
  from pg_temp.e('b')), 'old entry point: won without a value, dated today');

-- Shape is enforced in the table too.
select pg_temp.expect_error(format('update public.enquiries set outcome = ''quoted'' where id = %L', pg_temp.id('b')), '23514');

-- -------------------------------------------------------------------------------------------
-- Report: quoted, won and won value, staff only
-- -------------------------------------------------------------------------------------------
update public.enquiries set submitted_at = '2001-02-01T10:00:00Z' where id in (pg_temp.id('a'), pg_temp.id('b'));
set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-0000000007b1');
insert into r values ('rep', public.pilot_report('2001-02-01', '2001-02-01'));
reset role;
create function pg_temp.row(p_dim text, p_key text) returns jsonb language sql as $$
  select x from jsonb_array_elements((select value -> 'rows' from r where name = 'rep')) x
  where x ->> 'dim' = p_dim and x ->> 'key' = p_key
$$;
select pg_temp.expect((pg_temp.row('all', 'all') ->> 'saved')::int = 2, 'saved');
select pg_temp.expect((pg_temp.row('all', 'all') ->> 'quoted')::int = 2, 'quoted counts quotes and wins');
select pg_temp.expect((pg_temp.row('all', 'all') ->> 'won')::int = 2, 'won');
select pg_temp.expect((pg_temp.row('all', 'all') ->> 'won_value')::numeric = 18000, 'won value (a win without a value adds nothing)');
select pg_temp.expect((pg_temp.row('route', 'phone') ->> 'won')::int = 2, 'split by route');
-- No money in the visit table.
select pg_temp.expect(not exists (select 1 from information_schema.columns
  where table_schema = 'public' and table_name = 'landing_sessions'
    and (column_name like '%value%' or column_name like '%amount%')), 'no money in landing_sessions');

rollback;
