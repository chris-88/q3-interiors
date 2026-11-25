-- Part C (pilot measures) against the real database, in one transaction that is always rolled
-- back: landing sessions (access, validation, limit, no personal fields), the chase flag, and the
-- report arithmetic on seeded rows.
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
-- What PostgREST sets for a browser request through Cloudflare.
create function pg_temp.browser(p_agent text default 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1')
returns void language sql as $$
  select set_config('request.headers', json_build_object('user-agent', p_agent, 'cf-connecting-ip', '203.0.113.77')::text, true)
$$;
grant execute on all functions in schema pg_temp to anon, authenticated;
create temp table r (name text primary key, value jsonb);
grant all on r to anon, authenticated, service_role;
update public.booking_settings set enquiry_limit_per_hour = 100, visit_limit_per_hour = 10;
delete from public.landing_sessions;

-- -------------------------------------------------------------------------------------------
-- A session row holds exactly these fields: adding a personal one fails here.
-- -------------------------------------------------------------------------------------------
select pg_temp.expect(
  (select array_agg(column_name::text order by column_name) from information_schema.columns
   where table_schema = 'public' and table_name = 'landing_sessions')
  = array['chosen_at', 'chosen_route', 'click_id_present', 'form_version', 'id', 'started_at',
          'surface', 'tracking', 'utm_campaign', 'utm_content', 'utm_medium', 'utm_source', 'utm_term'],
  'landing_sessions has only the agreed, non-personal columns');

-- -------------------------------------------------------------------------------------------
-- anon: writes through record_visit only, reads nothing
-- -------------------------------------------------------------------------------------------
set local role anon;
select pg_temp.browser();
select public.record_visit('00000000-0000-4000-8000-00000000c001', 'landing', 2,
  '{"utm_source": "instagram", "utm_campaign": "kitchens", "click_id_present": true, "name": "Ann", "email": "a@example.invalid"}');
-- A reload: the same id is not a second session.
select public.record_visit('00000000-0000-4000-8000-00000000c001', 'landing', 2,
  '{"utm_source": "instagram", "utm_campaign": "kitchens"}');
select public.record_visit('00000000-0000-4000-8000-00000000c001', 'landing', 2, null, 'on_site');
-- Only the first choice is kept.
select public.record_visit('00000000-0000-4000-8000-00000000c001', 'landing', 2, null, 'phone');
select pg_temp.expect_error('select * from public.landing_sessions', '42501');
select pg_temp.expect_error('insert into public.landing_sessions (id, surface, form_version, tracking) values (gen_random_uuid(), ''landing'', 2, ''unknown'')', '42501');
select pg_temp.expect_error('delete from public.landing_sessions', '42501');
select pg_temp.expect_error('select public.pilot_report(current_date, current_date)', '42501');
select pg_temp.expect_error('select public.set_chase_details(gen_random_uuid(), true, ''Missing Eircode'')', '42501');
-- Junk is refused.
select pg_temp.expect_error($$select public.record_visit(null, 'landing', 2)$$, '22023');
select pg_temp.expect_error($$select public.record_visit(gen_random_uuid(), 'admin', 2)$$, '22023');
select pg_temp.expect_error($$select public.record_visit(gen_random_uuid(), 'landing', 0)$$, '22023');
select pg_temp.expect_error($$select public.record_visit(gen_random_uuid(), 'landing', 2, null, 'video')$$, '22023');
select pg_temp.expect_error($$select public.record_visit(gen_random_uuid(), 'landing', 2, '"x"')$$, '22023');
select pg_temp.expect_error(format('select public.record_visit(gen_random_uuid(), ''landing'', 2, %L)',
  jsonb_build_object('utm_source', repeat('x', 5000))), '22023');
-- Non-browsers are ignored silently.
select pg_temp.browser('curl/8.10.1');
select public.record_visit('00000000-0000-4000-8000-00000000c002', 'landing', 2);
select pg_temp.browser('facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)');
select public.record_visit('00000000-0000-4000-8000-00000000c003', 'landing', 2);
select pg_temp.browser('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/131.0 Safari/537.36');
select public.record_visit('00000000-0000-4000-8000-00000000c004', 'landing', 2);
-- The per-address limit (10 here; the first session used 3 units): the flood stops counting.
select pg_temp.browser();
select public.record_visit(gen_random_uuid(), 'enquire', 2) from generate_series(1, 20);
reset role;

select pg_temp.expect((select count(*) from public.landing_sessions) = 8, 'one session, then 7 more until the limit');
select pg_temp.expect((select row(surface, form_version, tracking, utm_source, utm_campaign, click_id_present, chosen_route)
  = row('landing'::text, 2, 'tagged'::text, 'instagram'::text, 'kitchens'::text, true, 'on_site'::text)
  from public.landing_sessions where id = '00000000-0000-4000-8000-00000000c001'),
  'tags kept, personal keys dropped, first route kept');
select pg_temp.expect(not exists (select 1 from public.landing_sessions where id in
  ('00000000-0000-4000-8000-00000000c002', '00000000-0000-4000-8000-00000000c003', '00000000-0000-4000-8000-00000000c004')),
  'non-browsers are not counted');
select pg_temp.expect((select count(*) from private.rate_limit_hits where bucket = 'visit') = 10,
  'the limit stores a keyed hash only, as the other limits do');

-- The submission carries the session; an unknown session id is not linked.
set local role anon;
select pg_temp.browser();
insert into r values ('e1', public.submit_enquiry_with_access('00000000-0000-4000-8000-00000000c101', 'enquiry', 2,
  '{"appointment_preference": "on_site", "project_type": "kitchen", "location": "Dublin 8", "name": "Test Person",
    "email": "pilot1@example.invalid", "phone": "087 123 4567", "site_street": "12 Example Road"}',
  false, '{"utm_source": "instagram", "utm_campaign": "kitchens"}', null, '00000000-0000-4000-8000-00000000c001'));
insert into r values ('e2', public.submit_enquiry_with_access('00000000-0000-4000-8000-00000000c102', 'enquiry', 2,
  '{"appointment_preference": "phone", "project_type": "bathroom", "location": "Cork", "name": "Test Person",
    "email": "pilot2@example.invalid", "phone": "087 123 4567"}',
  false, null, null, '00000000-0000-4000-8000-0000000c0fff'));
reset role;
create function pg_temp.eid(p text) returns uuid language sql as $$
  select id from public.enquiries where reference = (select value ->> 'reference' from r where name = p)
$$;
select pg_temp.expect((select landing_session_id = '00000000-0000-4000-8000-00000000c001'
  from public.enquiries where id = pg_temp.eid('e1')), 'session linked to its enquiry');
select pg_temp.expect((select landing_session_id is null from public.enquiries where id = pg_temp.eid('e2')),
  'an unrecorded session id is not linked');

-- -------------------------------------------------------------------------------------------
-- The chase flag: any active staff member, server-checked, history kept
-- -------------------------------------------------------------------------------------------
insert into auth.users (id, aud, role, email) values
  ('00000000-0000-4000-8000-00000000c201', 'authenticated', 'authenticated', 'staffc@example.invalid'),
  ('00000000-0000-4000-8000-00000000c202', 'authenticated', 'authenticated', 'offc@example.invalid'),
  ('00000000-0000-4000-8000-00000000c203', 'authenticated', 'authenticated', 'outsiderc@example.invalid');
select private.add_staff('00000000-0000-4000-8000-00000000c201', 'staffc@example.invalid', 'Staff C', 'staff');
select private.add_staff('00000000-0000-4000-8000-00000000c202', 'offc@example.invalid', 'Off C', 'staff');
select private.set_staff_active('00000000-0000-4000-8000-00000000c202', false);

set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-00000000c203');
select pg_temp.expect_error(format('select public.set_chase_details(%L, true, ''Missing Eircode'')', pg_temp.eid('e1')), '42501');
select pg_temp.as_user('00000000-0000-4000-8000-00000000c202');
select pg_temp.expect_error(format('select public.set_chase_details(%L, true, ''Missing Eircode'')', pg_temp.eid('e1')), '42501');
select pg_temp.as_user('00000000-0000-4000-8000-00000000c201');
select pg_temp.expect_error(format('select public.set_chase_details(%L, true, ''x'')', pg_temp.eid('e1')), '22023');
select pg_temp.expect_error(format('update public.enquiries set chase_note = ''x'' where id = %L', pg_temp.eid('e1')), '42501');
select public.set_chase_details(pg_temp.eid('e1'), true, 'No house number');
select public.set_chase_details(pg_temp.eid('e1'), true, 'No house number or Eircode');
select pg_temp.expect_error('select * from public.landing_sessions', '42501');
reset role;
select pg_temp.expect((select chase_flagged_at is not null and chase_note = 'No house number or Eircode'
  and chase_flagged_by_name = 'Staff C' from public.enquiries where id = pg_temp.eid('e1')), 'flag and note saved');
select pg_temp.expect((select array_agg(kind::text order by id) from public.enquiry_events
  where enquiry_id = pg_temp.eid('e1') and kind like 'chase%') = array['chase_flagged', 'chase_updated'],
  'history recorded');

-- -------------------------------------------------------------------------------------------
-- Report arithmetic on seeded rows
-- -------------------------------------------------------------------------------------------
-- e1: on_site, booked 2 hours after its session, attended, chased. e2: phone, not booked.
-- e3: a v1 enquiry, booked and attended but unsuitable. All moved to 1 January 2001 (Dublin),
-- a day no live data can fall on.
insert into r values ('e3', public.submit_enquiry_with_access('00000000-0000-4000-8000-00000000c103', 'enquiry', 1,
  '{"project_type": "kitchen", "description": "Replace the kitchen units.", "location": "D07", "timing": "flexible",
    "name": "Test Person", "email": "pilot3@example.invalid", "phone": "087 123 4567"}'));
update public.enquiries set status = 'unsuitable', status_reason = 'Outside what we do' where id = pg_temp.eid('e3');
update public.booking_settings set sessions_counted_from = '2000-01-01T00:00:00Z';
update public.landing_sessions set started_at = '2001-01-01T09:00:00Z';
update public.landing_sessions set started_at = '2001-01-01T10:00:00Z'
where id = '00000000-0000-4000-8000-00000000c001';
update public.enquiries set submitted_at = '2001-01-01T10:10:00Z' where id = pg_temp.eid('e1');
update public.enquiries set submitted_at = '2001-01-01T11:00:00Z' where id = pg_temp.eid('e2');
update public.enquiries set submitted_at = '2001-01-01T12:00:00Z' where id = pg_temp.eid('e3');
insert into public.bookings (enquiry_id, staff_user_id, appointment_type_id, starts_at, ends_at, blocked, state,
  calendar_event_id, idempotency_key, confirmed_at, attendance)
select pg_temp.eid(n), public.bookable_staff(), t, s::timestamptz, s::timestamptz + interval '20 minutes',
  tstzrange(s::timestamptz, s::timestamptz + interval '1 hour'),
  'confirmed', 'q3pilot' || n, gen_random_uuid(), c::timestamptz, 'attended'
from (values ('e1', 'site_visit', '2001-01-03T10:00:00Z', '2001-01-01T12:00:00Z'),
             ('e3', 'phone_consultation', '2001-01-04T10:00:00Z', '2001-01-01T13:00:00Z')) v(n, t, s, c);

set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-00000000c201');
insert into r values ('rep', public.pilot_report('2001-01-01', '2001-01-01'));
reset role;

create function pg_temp.row(p_dim text, p_key text) returns jsonb language sql as $$
  select x from jsonb_array_elements((select value -> 'rows' from r where name = 'rep')) x
  where x ->> 'dim' = p_dim and x ->> 'key' = p_key
$$;
select pg_temp.expect((pg_temp.row('all', 'all') ->> 'sessions')::int = 8, 'sessions counted');
select pg_temp.expect((pg_temp.row('all', 'all') ->> 'chose')::int = 1, 'sessions that chose a route');
select pg_temp.expect((pg_temp.row('all', 'all') ->> 'saved')::int = 3, 'saved enquiries');
select pg_temp.expect((pg_temp.row('all', 'all') ->> 'booked')::int = 2, 'confirmed bookings');
select pg_temp.expect((pg_temp.row('all', 'all') ->> 'attended')::int = 2, 'attended');
select pg_temp.expect((pg_temp.row('all', 'all') ->> 'suitable_attended')::int = 1, 'unsuitable not counted as suitable');
select pg_temp.expect((pg_temp.row('all', 'all') ->> 'chased')::int = 1, 'chased bookings');
select pg_temp.expect((pg_temp.row('version', '1') ->> 'sessions') is null, 'v1 has no sessions (not counted)');
select pg_temp.expect((pg_temp.row('version', '1') ->> 'saved')::int = 1, 'v1 saved');
select pg_temp.expect((pg_temp.row('version', '2') ->> 'saved')::int = 2, 'v2 saved');
select pg_temp.expect((pg_temp.row('route', 'on_site') ->> 'booked')::int = 1, 'visit booked');
select pg_temp.expect((pg_temp.row('route', 'phone') ->> 'saved')::int = 2, 'calls: the v2 preference and the v1 booked type');
select pg_temp.expect((pg_temp.row('campaign', 'kitchens') ->> 'sessions')::int = 1, 'campaign sessions');
select pg_temp.expect((pg_temp.row('all', 'all') ->> 'median_to_saved_seconds')::int = 600, 'median landing to saved (10 min)');
select pg_temp.expect((pg_temp.row('all', 'all') ->> 'median_to_booked_seconds')::int = 7200, 'median landing to booked (2 h)');
select pg_temp.expect(((select value -> 'headline' from r where name = 'rep') ->> 'instagram_sessions')::int = 1, 'instagram sessions');
select pg_temp.expect(((select value -> 'headline' from r where name = 'rep') ->> 'instagram_suitable_attended')::int = 1,
  'suitable attended from Instagram');

-- Retention: sessions older than 13 months go with the daily job.
update public.landing_sessions set started_at = now() - interval '14 months'
where id = '00000000-0000-4000-8000-00000000c001';
select pg_temp.expect(pg_get_functiondef('private.run_retention'::regproc) like '%private.purge_landing_sessions()%',
  'the daily retention job purges sessions');
select private.purge_landing_sessions();
select pg_temp.expect(not exists (select 1 from public.landing_sessions where id = '00000000-0000-4000-8000-00000000c001'),
  'old sessions deleted');
select pg_temp.expect((select landing_session_id is null from public.enquiries where id = pg_temp.eid('e1')),
  'the enquiry stays, unlinked');

rollback;
