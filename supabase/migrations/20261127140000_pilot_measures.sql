-- Enquiry form v2, part C: the pilot measures.
--
-- 1. Landing sessions, first-party: one row per browser tab that arrives on the landing page or
--    the enquiry form. No cookie, no personal details, no address; the id is random per tab
--    (sessionStorage) and is not linked to anything else in the browser. Anon writes through one
--    security-definer function, `public.record_visit`, and can read nothing. The enquiry carries
--    the session id (`enquiries.landing_session_id`) so a session joins its enquiry and booking.
-- 2. "Had to chase details": a staff flag with what was missing, history recorded.
-- 3. `public.pilot_report`: sessions, saved, booked, attended per form version, route and
--    campaign, the two headline measures and median times. Staff only.

alter table public.booking_settings
  -- When session counting began: earlier days (and v1) show "not counted", not zero.
  add column sessions_counted_from timestamptz not null default now(),
  add column visit_limit_per_hour integer not null default 120
    check (visit_limit_per_hour between 10 and 5000);

alter table private.rate_limit_hits drop constraint rate_limit_hits_bucket_check;
alter table private.rate_limit_hits add constraint rate_limit_hits_bucket_check
  check (bucket in ('enquiry', 'booking_write', 'booking_read', 'password_reset', 'visit'));

-- ---------------------------------------------------------------------------------------------
-- 1. Landing sessions
-- ---------------------------------------------------------------------------------------------

-- Exactly these columns. supabase/tests/pilot.sql pins the list: a personal field added here
-- fails the tests.
create table public.landing_sessions (
  id uuid primary key,
  started_at timestamptz not null default now(),
  surface text not null check (surface in ('landing', 'enquire')),
  form_version integer not null check (form_version between 1 and 99),
  tracking text not null check (tracking in ('tagged', 'unknown')),
  utm_source text check (char_length(utm_source) between 1 and 200),
  utm_medium text check (char_length(utm_medium) between 1 and 200),
  utm_campaign text check (char_length(utm_campaign) between 1 and 200),
  utm_content text check (char_length(utm_content) between 1 and 200),
  utm_term text check (char_length(utm_term) between 1 and 200),
  click_id_present boolean,
  chosen_route text check (chosen_route in ('phone', 'on_site')),
  chosen_at timestamptz
);
create index landing_sessions_started on public.landing_sessions (started_at);

comment on table public.landing_sessions is
  'One row per browser tab arriving on the landing page or enquiry form. No personal data, no address, no cookie. Deleted after 13 months.';

revoke all on table public.landing_sessions from public, anon, authenticated;
grant select, insert, update, delete on table public.landing_sessions to service_role;
alter table public.landing_sessions enable row level security;
-- No policies: nobody reads rows directly; staff see aggregates through pilot_report().

alter table public.enquiries
  add column landing_session_id uuid references public.landing_sessions (id) on delete set null;
create index enquiries_landing_session on public.enquiries (landing_session_id);

-- The write path. Arrival (p_route null) inserts once per id; a later call with the route the
-- customer tapped records the first choice only. Malformed input raises 22023; a non-browser
-- caller or an address over its hourly limit is ignored silently.
create function public.record_visit(
  p_session_id uuid,
  p_surface text,
  p_form_version integer,
  p_attribution jsonb default null,
  p_route text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_ws constant text := E' \t\r\n';
  v_headers json := coalesce(nullif(current_setting('request.headers', true), ''), '{}')::json;
  v_agent text;
  v_limit integer;
  v_attr jsonb := case when jsonb_typeof(p_attribution) = 'object' then p_attribution end;
  v_utm jsonb := '{}'::jsonb;
  v_key text;
  v_text text;
  v_click boolean;
begin
  if p_session_id is null or p_surface is null or p_surface not in ('landing', 'enquire')
     or p_form_version is null or p_form_version not between 1 and 99
     or (p_route is not null and p_route not in ('phone', 'on_site'))
     or (p_attribution is not null and jsonb_typeof(p_attribution) not in ('object', 'null'))
     or octet_length(coalesce(p_attribution::text, '')) > 4000 then
    raise exception 'invalid visit' using errcode = '22023';
  end if;

  -- Browsers only: link previews, crawlers, scripts and headless tools are not visits.
  v_agent := coalesce(v_headers ->> 'user-agent', '');
  if v_agent !~ '^Mozilla/5\.0 \('
     or v_agent ~* '(bot|crawl|spider|slurp|preview|facebookexternalhit|whatsapp|headless|lighthouse|curl|wget|python|httpclient|okhttp|go-http)' then
    return;
  end if;

  select visit_limit_per_hour into v_limit from public.booking_settings limit 1;
  if not private.rate_limit_take('visit', private.address_hash(private.request_address()),
                                 p_session_id::text || ':' || coalesce(p_route, 'arrive'),
                                 coalesce(v_limit, 120)) then
    return;
  end if;

  -- The same campaign fields attribution keeps; anything else is ignored.
  if v_attr is not null then
    foreach v_key in array array['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'] loop
      if jsonb_typeof(v_attr -> v_key) = 'string' then
        v_text := left(btrim(v_attr ->> v_key, c_ws), 200);
        if v_text <> '' then
          v_utm := v_utm || jsonb_build_object(v_key, v_text);
        end if;
      end if;
    end loop;
    if jsonb_typeof(v_attr -> 'click_id_present') = 'boolean' then
      v_click := (v_attr ->> 'click_id_present')::boolean;
    end if;
  end if;

  insert into public.landing_sessions as s (
    id, surface, form_version, tracking, utm_source, utm_medium, utm_campaign, utm_content,
    utm_term, click_id_present, chosen_route, chosen_at
  ) values (
    p_session_id, p_surface, p_form_version,
    case when v_utm <> '{}'::jsonb or coalesce(v_click, false) then 'tagged' else 'unknown' end,
    v_utm ->> 'utm_source', v_utm ->> 'utm_medium', v_utm ->> 'utm_campaign',
    v_utm ->> 'utm_content', v_utm ->> 'utm_term', v_click,
    p_route, case when p_route is not null then now() end
  )
  on conflict (id) do update
    set chosen_route = coalesce(s.chosen_route, excluded.chosen_route),
        chosen_at = coalesce(s.chosen_at, excluded.chosen_at);
end;
$$;

revoke all on function public.record_visit(uuid, text, integer, jsonb, text) from public, anon, authenticated;
grant execute on function public.record_visit(uuid, text, integer, jsonb, text) to anon, authenticated;

-- The submission carries the tab's session id. Replaces the signature with one more defaulted
-- parameter (older pages still resolve); behaviour otherwise unchanged.
drop function public.submit_enquiry_with_access(uuid, text, integer, jsonb, boolean, jsonb, text);

create function public.submit_enquiry_with_access(
  p_idempotency_key uuid,
  p_form_id text,
  p_form_version integer,
  p_answers jsonb,
  p_marketing_opt_in boolean default false,
  p_attribution jsonb default null,
  -- A field people never see. Anything in it means a bot: answer normally, store nothing.
  p_trap text default null,
  -- The landing session (random per tab); linked only if that session was recorded.
  p_session_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reference text;
  v_id uuid;
  v_limit integer;
  c_alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
begin
  -- A retry of a saved enquiry is not a new submission: no limit, same reference.
  select id, reference into v_id, v_reference from public.enquiries where idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object('reference', v_reference) || private.mint_enquiry_token(v_id);
  end if;

  select enquiry_limit_per_hour into v_limit from public.booking_settings limit 1;
  if not private.rate_limit_take('enquiry', private.address_hash(private.request_address()),
                                 p_idempotency_key::text, coalesce(v_limit, 5)) then
    raise sqlstate 'PT429' using message = 'rate_limited',
      hint = 'Too many enquiries from this address. Please try again later.';
  end if;

  if nullif(btrim(coalesce(p_trap, '')), '') is not null then
    return jsonb_build_object(
      'reference', 'Q3-' || (
        select string_agg(substr(c_alphabet, 1 + floor(random() * length(c_alphabet))::integer, 1), '')
        from generate_series(1, 6)),
      'access_token', null,
      'expires_at', null);
  end if;

  v_reference := public.submit_enquiry(
    p_idempotency_key, p_form_id, p_form_version, p_answers, p_marketing_opt_in, p_attribution);
  select id into v_id from public.enquiries where idempotency_key = p_idempotency_key;
  perform private.sync_site_details_from_answers(v_id);
  if p_session_id is not null then
    update public.enquiries set landing_session_id = p_session_id
    where id = v_id and exists (select 1 from public.landing_sessions where id = p_session_id);
  end if;
  perform private.queue_staff_alert(v_id, 'staff_new_enquiry');
  return jsonb_build_object('reference', v_reference) || private.mint_enquiry_token(v_id);
end;
$$;

revoke all on function public.submit_enquiry_with_access(uuid, text, integer, jsonb, boolean, jsonb, text, uuid) from public, anon, authenticated;
grant execute on function public.submit_enquiry_with_access(uuid, text, integer, jsonb, boolean, jsonb, text, uuid) to anon, authenticated;

-- Retention: sessions are deleted 13 months after they start, by the daily q3-retention job
-- (whatever the enquiry retention setting).
create function private.purge_landing_sessions()
returns integer
language sql
set search_path = ''
as $$
  with gone as (
    delete from public.landing_sessions where started_at < now() - interval '13 months' returning 1)
  select count(*)::integer from gone;
$$;
revoke all on function private.purge_landing_sessions() from public;

create or replace function private.run_retention()
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_months integer;
  v_id uuid;
  v_count integer := 0;
begin
  perform private.purge_landing_sessions();
  select retention_months into v_months from public.booking_settings limit 1;
  if v_months is null then
    return 0;
  end if;
  for v_id in select * from private.retention_candidates(v_months) loop
    perform private.delete_enquiry_data(v_id, 'retention', null);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- 2. "Had to chase details"
-- ---------------------------------------------------------------------------------------------

alter table public.enquiries
  add column chase_flagged_at timestamptz,
  add column chase_note text check (chase_note is null or char_length(chase_note) between 3 and 500),
  add column chase_flagged_by_name text,
  add constraint chase_flag_has_note check ((chase_flagged_at is null) = (chase_note is null));

alter table public.enquiry_events drop constraint enquiry_events_kind_check;
alter table public.enquiry_events
  add constraint enquiry_events_kind_check check (kind in (
    'submitted', 'status_changed', 'site_details_added', 'contact_requested',
    'booking_requested', 'booking_confirmed', 'booking_failed', 'booking_retrying',
    'email_sent', 'email_failed',
    'booking_cancelled', 'booking_rescheduled', 'calendar_updated', 'calendar_update_failed',
    'attendance_recorded', 'outcome_recorded', 'outcome_cleared',
    'details_updated', 'prepare_updated', 'photo_added', 'photo_removed',
    'chase_flagged', 'chase_updated', 'chase_cleared'
  ));

-- Any active staff member. p_flagged false clears the flag (the note goes too).
create function public.set_chase_details(p_enquiry_id uuid, p_flagged boolean, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
  v_before public.enquiries;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if not public.is_staff() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select display_name into v_name from public.staff where user_id = (select auth.uid());
  select * into v_before from public.enquiries where id = p_enquiry_id for update;
  if not found then
    raise exception 'enquiry not found' using errcode = 'P0002';
  end if;
  if coalesce(p_flagged, false) then
    if v_note is null or char_length(v_note) not between 3 and 500 then
      raise exception 'say what was missing (3 to 500 characters)' using errcode = '22023';
    end if;
    if v_before.chase_flagged_at is not null and v_before.chase_note = v_note then
      return;
    end if;
    update public.enquiries
    set chase_flagged_at = coalesce(chase_flagged_at, now()), chase_note = v_note,
        chase_flagged_by_name = v_name, updated_at = now()
    where id = p_enquiry_id;
    insert into public.enquiry_events (enquiry_id, kind, detail, actor_name)
    values (p_enquiry_id,
            case when v_before.chase_flagged_at is null then 'chase_flagged' else 'chase_updated' end,
            v_note, v_name);
  else
    if v_before.chase_flagged_at is null then
      return;
    end if;
    update public.enquiries
    set chase_flagged_at = null, chase_note = null, chase_flagged_by_name = null, updated_at = now()
    where id = p_enquiry_id;
    insert into public.enquiry_events (enquiry_id, kind, actor_name)
    values (p_enquiry_id, 'chase_cleared', v_name);
  end if;
end;
$$;

revoke all on function public.set_chase_details(uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.set_chase_details(uuid, boolean, text) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 3. The pilot report
-- ---------------------------------------------------------------------------------------------

-- For enquiries and sessions in the Irish date range. Rows by dimension: 'all', 'version'
-- (form version), 'route' (the call-or-visit choice; for enquiries the v2 preference, else the
-- booked type, else 'unknown'; for sessions the tapped route, else 'none'), 'campaign'
-- (utm_campaign or '(unknown)'). sessions is null when no session falls in that row.
-- Suitable = an attended appointment whose enquiry is not marked unsuitable.
-- Instagram = utm_source 'instagram' or 'ig' (any case).
create function public.pilot_report(p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_counted_from timestamptz;
  v_rows jsonb;
  v_headline jsonb;
begin
  if not public.is_staff() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 3660 then
    raise exception 'invalid date range' using errcode = '22023';
  end if;
  select sessions_counted_from into v_counted_from from public.booking_settings limit 1;

  with s as (
    select ls.form_version, ls.chosen_route,
           coalesce(nullif(ls.utm_campaign, ''), '(unknown)') as campaign,
           lower(coalesce(ls.utm_source, '')) in ('instagram', 'ig') as instagram
    from public.landing_sessions ls
    where (ls.started_at at time zone 'Europe/Dublin')::date between p_from and p_to
  ),
  e as (
    select en.id, en.form_version, en.status, en.submitted_at, en.chase_flagged_at,
           en.landing_session_id,
           coalesce(nullif(a.utm_campaign, ''), '(unknown)') as campaign,
           lower(coalesce(a.utm_source, '')) in ('instagram', 'ig') as instagram,
           case when en.answers ->> 'appointment_preference' in ('phone', 'on_site')
                then en.answers ->> 'appointment_preference' end as preference
    from public.enquiries en
    left join public.enquiry_attribution a on a.enquiry_id = en.id
    where (en.submitted_at at time zone 'Europe/Dublin')::date between p_from and p_to
  ),
  b as (
    select bk.enquiry_id,
           min(bk.confirmed_at) as confirmed_at,
           bool_or(bk.attendance = 'attended') as attended,
           (array_agg(t.mode order by bk.created_at))[1] as booked_mode
    from public.bookings bk
    join public.appointment_types t on t.id = bk.appointment_type_id
    where bk.enquiry_id in (select id from e) and bk.confirmed_at is not null
    group by bk.enquiry_id
  ),
  eb as (
    select e.*, coalesce(e.preference, b.booked_mode, 'unknown') as route, b.confirmed_at,
           coalesce(b.attended, false) as attended, ls.started_at as session_started
    from e
    left join b on b.enquiry_id = e.id
    left join public.landing_sessions ls on ls.id = e.landing_session_id
  ),
  sess as (
    select dim, key, count(*) as sessions, count(*) filter (where chosen_route is not null) as chose
    from (
      select 'all' as dim, 'all' as key, chosen_route from s
      union all select 'version', form_version::text, chosen_route from s
      union all select 'route', coalesce(chosen_route, 'none'), chosen_route from s
      union all select 'campaign', campaign, chosen_route from s
    ) x
    group by dim, key
  ),
  enq as (
    select dim, key,
           count(*) as saved,
           count(*) filter (where confirmed_at is not null) as booked,
           count(*) filter (where attended) as attended,
           count(*) filter (where attended and status <> 'unsuitable') as suitable_attended,
           count(*) filter (where confirmed_at is not null and chase_flagged_at is not null) as chased,
           percentile_cont(0.5) within group (order by extract(epoch from submitted_at - session_started))
             filter (where session_started is not null) as median_to_saved_seconds,
           percentile_cont(0.5) within group (order by extract(epoch from confirmed_at - session_started))
             filter (where session_started is not null and confirmed_at is not null) as median_to_booked_seconds
    from (
      select 'all' as dim, 'all' as key, eb.* from eb
      union all select 'version', eb.form_version::text, eb.* from eb
      union all select 'route', eb.route, eb.* from eb
      union all select 'campaign', eb.campaign, eb.* from eb
    ) x
    group by dim, key
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'dim', coalesce(sess.dim, enq.dim),
           'key', coalesce(sess.key, enq.key),
           'sessions', sess.sessions,
           'chose', sess.chose,
           'saved', coalesce(enq.saved, 0),
           'booked', coalesce(enq.booked, 0),
           'attended', coalesce(enq.attended, 0),
           'suitable_attended', coalesce(enq.suitable_attended, 0),
           'chased', coalesce(enq.chased, 0),
           'median_to_saved_seconds', round(enq.median_to_saved_seconds::numeric),
           'median_to_booked_seconds', round(enq.median_to_booked_seconds::numeric))
         order by coalesce(sess.dim, enq.dim), coalesce(enq.saved, 0) desc, coalesce(sess.key, enq.key)), '[]'::jsonb)
  into v_rows
  from sess full join enq on enq.dim = sess.dim and enq.key = sess.key;

  select jsonb_build_object(
    'instagram_sessions', (select count(*) from public.landing_sessions ls
       where (ls.started_at at time zone 'Europe/Dublin')::date between p_from and p_to
         and lower(coalesce(ls.utm_source, '')) in ('instagram', 'ig')),
    'instagram_suitable_attended', (
       select count(*) from public.enquiries en
       join public.enquiry_attribution a on a.enquiry_id = en.id
       where (en.submitted_at at time zone 'Europe/Dublin')::date between p_from and p_to
         and en.submitted_at >= v_counted_from
         and lower(coalesce(a.utm_source, '')) in ('instagram', 'ig')
         and en.status <> 'unsuitable'
         and exists (select 1 from public.bookings bk where bk.enquiry_id = en.id
                     and bk.confirmed_at is not null and bk.attendance = 'attended'))
  ) into v_headline;

  return jsonb_build_object(
    'counted_from', v_counted_from,
    'rows', v_rows,
    'headline', v_headline);
end;
$$;

revoke all on function public.pilot_report(date, date) from public, anon, authenticated;
grant execute on function public.pilot_report(date, date) to authenticated;
