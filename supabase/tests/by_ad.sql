-- Pilot measures per ad (utm_content within a campaign). One transaction, always rolled back.
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

-- Sessions on 1 March 2001 (a day no live data can fall on): campaign type-test-1 with three
-- ads, untagged ones, a flood of 40 junk contents, and another campaign that must not show.
insert into public.landing_sessions (id, started_at, surface, form_version, tracking, utm_campaign, utm_content, chosen_route)
select gen_random_uuid(), '2001-03-01T10:00:00Z', 'landing', 2, 'tagged', c, nullif(t, ''), r
from (values
  ('type-test-1', 'kitchen-calls', 'phone'), ('type-test-1', 'kitchen-calls', null),
  ('type-test-1', 'kitchen-calls', 'on_site'), ('type-test-1', 'kitchen-calls', null),
  ('type-test-1', 'price-first', 'phone'), ('type-test-1', 'price-first', null),
  ('type-test-1', 'one-team-animated', null), ('type-test-1', 'one-team-animated', null),
  ('type-test-1', '', null), ('type-test-1', '', null),
  ('other-campaign', 'kitchen-calls', null)) v(c, t, r);
insert into public.landing_sessions (id, started_at, surface, form_version, tracking, utm_campaign, utm_content)
select gen_random_uuid(), '2001-03-01T11:00:00Z', 'landing', 2, 'tagged', 'type-test-1', 'junk-' || g
from generate_series(1, 40) g;
insert into r values ('s_kitchen', to_jsonb((select id from public.landing_sessions
  where utm_content = 'kitchen-calls' and utm_campaign = 'type-test-1' and chosen_route = 'phone')));

-- Two enquiries from kitchen-calls (one linked to its session, won), one from price-first.
create function pg_temp.enquiry(p_key text, p_content text, p_session uuid) returns uuid language plpgsql as $$
declare v jsonb;
begin
  v := public.submit_enquiry_with_access(p_key::uuid, 'enquiry', 2,
    '{"appointment_preference": "phone", "project_type": "kitchen", "location": "Dublin 8",
      "name": "Test Person", "email": "byad@example.invalid", "phone": "087 123 4567"}'::jsonb,
    false, jsonb_build_object('utm_source', 'instagram', 'utm_campaign', 'type-test-1', 'utm_content', p_content),
    null, p_session);
  return (select id from public.enquiries where reference = v ->> 'reference');
end;
$$;
insert into r values ('e1', to_jsonb(pg_temp.enquiry('00000000-0000-4000-8000-0000000008a1', 'kitchen-calls',
  (select (value #>> '{}')::uuid from r where name = 's_kitchen'))));
insert into r values ('e2', to_jsonb(pg_temp.enquiry('00000000-0000-4000-8000-0000000008a2', 'kitchen-calls', null)));
insert into r values ('e3', to_jsonb(pg_temp.enquiry('00000000-0000-4000-8000-0000000008a3', 'price-first', null)));
create function pg_temp.id(p text) returns uuid language sql as $$
  select (value #>> '{}')::uuid from r where name = p
$$;
update public.enquiries set submitted_at = '2001-03-01T10:20:00Z'
where id in (pg_temp.id('e1'), pg_temp.id('e2'), pg_temp.id('e3'));
update public.enquiries set outcome = 'won', outcome_value = 12000, won_date = '2001-03-10',
  outcome_at = now(), quote_amount = 12500, quote_date = '2001-03-05'
where id = pg_temp.id('e1');

insert into auth.users (id, aud, role, email) values
  ('00000000-0000-4000-8000-0000000008b1', 'authenticated', 'authenticated', 'staffad@example.invalid');
select private.add_staff('00000000-0000-4000-8000-0000000008b1', 'staffad@example.invalid', 'Staff Ad', 'staff');

-- anon cannot run it; the anon list is unchanged.
set local role anon;
select pg_temp.expect_error('select public.pilot_report_by_content(''2001-03-01'', ''2001-03-01'', ''type-test-1'')', '42501');
reset role;
select pg_temp.expect(
  (select array_agg(p.proname::text order by p.proname)
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'private') and has_function_privilege('anon', p.oid, 'execute'))
  = array['public_appointment_types', 'public_business_details', 'public_wording',
          'record_visit', 'submit_enquiry_with_access'],
  'anon may run only the five public functions');

set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-0000000008b1');
select pg_temp.expect_error('select public.pilot_report_by_content(''2001-03-01'', ''2001-03-01'', null)', '22023');
insert into r values ('rep', public.pilot_report_by_content('2001-03-01', '2001-03-01', 'type-test-1'));
reset role;

create function pg_temp.row(p_key text) returns jsonb language sql as $$
  select x from jsonb_array_elements((select value -> 'rows' from r where name = 'rep')) x
  where x ->> 'key' = p_key
$$;
select pg_temp.expect((pg_temp.row('kitchen-calls') ->> 'sessions')::int = 4, 'kitchen-calls sessions (other campaign excluded)');
select pg_temp.expect((pg_temp.row('kitchen-calls') ->> 'chose')::int = 2, 'kitchen-calls chose a route');
select pg_temp.expect((pg_temp.row('kitchen-calls') ->> 'saved')::int = 2, 'kitchen-calls saved');
select pg_temp.expect((pg_temp.row('kitchen-calls') ->> 'quoted')::int = 1, 'kitchen-calls quoted');
select pg_temp.expect((pg_temp.row('kitchen-calls') ->> 'won')::int = 1, 'kitchen-calls won');
select pg_temp.expect((pg_temp.row('kitchen-calls') ->> 'won_value')::numeric = 12000, 'kitchen-calls won value');
select pg_temp.expect((pg_temp.row('kitchen-calls') ->> 'median_to_saved_seconds')::int = 1200, 'landing to saved, joined session');
select pg_temp.expect((pg_temp.row('price-first') ->> 'sessions')::int = 2
  and (pg_temp.row('price-first') ->> 'saved')::int = 1, 'price-first');
select pg_temp.expect((pg_temp.row('(none)') ->> 'sessions')::int = 2, 'untagged sessions in (none)');
select pg_temp.expect(pg_temp.row('one-team-animated') is not null, 'a small ad keeps its row');
-- The cap: 25 named rows at most, the tail folded into (other), nothing lost.
select pg_temp.expect((select count(*) from jsonb_array_elements((select value -> 'rows' from r where name = 'rep')) x
  where x ->> 'key' not in ('(none)', '(other)')) = 25, 'at most 25 named rows');
select pg_temp.expect((select sum((x ->> 'sessions')::int) from jsonb_array_elements((select value -> 'rows' from r where name = 'rep')) x)
  = 50, 'every session is in some row');
select pg_temp.expect((pg_temp.row('(other)') ->> 'sessions')::int > 0, 'the tail is folded into (other)');
-- The biggest ads come first, (none) and (other) last.
select pg_temp.expect(((select value -> 'rows' -> 0 from r where name = 'rep') ->> 'key') = 'kitchen-calls', 'ordered by size');

rollback;
