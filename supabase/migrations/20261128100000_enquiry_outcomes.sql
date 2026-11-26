-- Slice 7: outcome tracking after the appointment (quoted, won, lost).
--
-- Shape: columns on `enquiries`, extending the slice 3 outcome columns, not a new table. An
-- enquiry has exactly one current commercial stage, every change is already written to
-- `enquiry_events` (who and when), and the enquiry stays the spine a future job record (estimate,
-- quote documents, finance, plan) will hang off by `enquiries.id`. A table of stage rows would
-- duplicate that history and make "the current stage" a query instead of a column.
--
-- Stages: none yet (null), quoted (amount in euro incl. VAT, and date), won (agreed value and
-- date), lost (reason from a short list, optional note; "other" needs a note). A quote recorded
-- before a win or loss is kept (`quote_amount`, `quote_date`), so the report can count it.
-- Writes go through `public.record_enquiry_outcome` (active staff only). The slice 3 function
-- `set_enquiry_outcome` keeps its signature for older open builds and delegates. History uses the
-- existing kinds `outcome_recorded` / `outcome_cleared`, so older builds render it.

alter table public.enquiries drop constraint enquiries_outcome_shape;
alter table public.enquiries drop constraint enquiries_outcome_reason_check;

-- Text with a check instead of the enum: a new enum value could not be used in the same
-- transaction that adds it, and older builds read the column as an open string anyway.
alter table public.enquiries alter column outcome type text using outcome::text;

alter table public.enquiries
  add column quote_amount numeric(12, 2) check (quote_amount is null or quote_amount > 0),
  add column quote_date date,
  add column won_date date;

-- Wins recorded before this slice: their date is the day they were recorded (Irish date).
update public.enquiries
set won_date = (outcome_at at time zone 'Europe/Dublin')::date
where outcome = 'won' and won_date is null;

alter table public.enquiries
  add constraint enquiries_outcome_check check (outcome in ('quoted', 'won', 'lost')),
  add constraint enquiries_outcome_reason_check check (outcome_reason in (
    'price', 'timing', 'chose_another', 'no_response', 'not_a_fit', 'project_cancelled', 'other')),
  add constraint enquiries_quote_pair check ((quote_amount is null) = (quote_date is null)),
  add constraint enquiries_outcome_shape check (
    (outcome is null and outcome_value is null and outcome_reason is null and outcome_note is null
       and outcome_at is null and won_date is null and quote_amount is null)
    or (outcome = 'quoted' and quote_amount is not null and outcome_value is null
        and outcome_reason is null and won_date is null and outcome_at is not null)
    -- outcome_value stays nullable for wins recorded before this slice (no agreed value asked).
    or (outcome = 'won' and outcome_reason is null and won_date is not null and outcome_at is not null)
    or (outcome = 'lost' and outcome_value is null and outcome_reason is not null
        and won_date is null and outcome_at is not null)
  );

comment on column public.enquiries.outcome is
  'Commercial stage after the appointment: null (none yet), quoted, won, lost. Not the handling status.';
comment on column public.enquiries.outcome_value is 'Won: the agreed value in euro, VAT included.';
comment on column public.enquiries.quote_amount is 'The quote in euro, VAT included; kept after a win or loss.';

-- p_stage: 'none' (clears everything, quote included), 'quoted', 'won' or 'lost'.
-- quoted: p_amount and p_on required. won: p_amount and p_on required (a quote already recorded
-- is kept). lost: p_reason required ('other' needs p_note); p_on is ignored.
-- The one writer. p_won_needs_amount is false only for the slice 3 entry point, whose form
-- treated the value as optional.
create function private.write_outcome(
  p_enquiry_id uuid,
  p_stage text,
  p_amount numeric,
  p_on date,
  p_reason text,
  p_note text,
  p_won_needs_amount boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
  v_before public.enquiries;
  v_note text := nullif(btrim(coalesce(p_note, ''), E' \t\r\n'), '');
  v_detail text;
  v_money text;
begin
  select display_name into v_name from public.staff where user_id = (select auth.uid()) and active;
  if not found then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select * into v_before from public.enquiries where id = p_enquiry_id for update;
  if not found then
    raise exception 'enquiry not found' using errcode = 'P0002';
  end if;
  if p_stage is null or p_stage not in ('none', 'quoted', 'won', 'lost') then
    raise exception 'unknown stage' using errcode = '22023';
  end if;
  if v_note is not null and char_length(v_note) > 500 then
    raise exception 'keep the note under 500 characters' using errcode = '22023';
  end if;

  if p_stage = 'none' then
    if v_before.outcome is null and v_before.quote_amount is null then
      return;
    end if;
    update public.enquiries
    set outcome = null, outcome_value = null, outcome_reason = null, outcome_note = null,
        outcome_at = null, won_date = null, quote_amount = null, quote_date = null,
        updated_at = now()
    where id = p_enquiry_id;
    insert into public.enquiry_events (enquiry_id, kind, actor_user_id, actor_name)
    values (p_enquiry_id, 'outcome_cleared', (select auth.uid()), v_name);
    return;
  end if;

  if p_stage in ('quoted', 'won') then
    if (p_amount is null and (p_stage = 'quoted' or p_won_needs_amount))
       or p_amount <= 0 or p_amount >= 10000000000 then
      raise exception 'enter the amount in euro' using errcode = '22023';
    end if;
    if p_on is null or p_on > (now() at time zone 'Europe/Dublin')::date + 1
       or p_on < date '2020-01-01' then
      raise exception 'enter the date' using errcode = '22023';
    end if;
    if p_reason is not null then
      raise exception 'only a lost enquiry has a reason' using errcode = '22023';
    end if;
  else
    if p_reason is null or p_reason not in (
         'price', 'timing', 'chose_another', 'no_response', 'not_a_fit', 'other') then
      raise exception 'choose a reason' using errcode = '22023';
    end if;
    if p_reason = 'other' and v_note is null then
      raise exception 'say why' using errcode = '22023';
    end if;
    if p_amount is not null then
      raise exception 'a lost enquiry has no amount' using errcode = '22023';
    end if;
  end if;

  v_money := coalesce('€' || to_char(p_amount, 'FM999G999G999G990D00'), 'no value given');
  if p_stage = 'quoted' then
    update public.enquiries
    set outcome = 'quoted', quote_amount = round(p_amount, 2), quote_date = p_on,
        outcome_value = null, outcome_reason = null, outcome_note = v_note, won_date = null,
        outcome_at = now(), updated_at = now()
    where id = p_enquiry_id;
    v_detail := 'Quoted ' || v_money || ' on ' || to_char(p_on, 'FMDD Mon YYYY');
  elsif p_stage = 'won' then
    update public.enquiries
    set outcome = 'won', outcome_value = round(p_amount, 2), won_date = p_on,
        outcome_reason = null, outcome_note = v_note, outcome_at = now(), updated_at = now()
    where id = p_enquiry_id;
    v_detail := 'Won ' || v_money || ' on ' || to_char(p_on, 'FMDD Mon YYYY');
  else
    update public.enquiries
    set outcome = 'lost', outcome_reason = p_reason, outcome_note = v_note, outcome_value = null,
        won_date = null, outcome_at = now(), updated_at = now()
    where id = p_enquiry_id;
    v_detail := 'Lost: ' || replace(p_reason, '_', ' ');
  end if;
  if v_before.outcome is not null then
    v_detail := v_detail || ' (was ' || v_before.outcome || ')';
  end if;
  v_detail := v_detail || coalesce('. ' || v_note, '');

  insert into public.enquiry_events (enquiry_id, kind, detail, actor_user_id, actor_name)
  values (p_enquiry_id, 'outcome_recorded', left(v_detail, 600), (select auth.uid()), v_name);
end;
$$;

revoke all on function private.write_outcome(uuid, text, numeric, date, text, text, boolean) from public;

create function public.record_enquiry_outcome(
  p_enquiry_id uuid,
  p_stage text,
  p_amount numeric default null,
  p_on date default null,
  p_reason text default null,
  p_note text default null
)
returns void
language sql
security definer
set search_path = ''
as $$
  select private.write_outcome(p_enquiry_id, p_stage, p_amount, p_on, p_reason, p_note, true);
$$;

revoke all on function public.record_enquiry_outcome(uuid, text, numeric, date, text, text) from public, anon, authenticated;
grant execute on function public.record_enquiry_outcome(uuid, text, numeric, date, text, text) to authenticated;

-- The slice 3 entry point, kept for staff consoles loaded before this release.
create or replace function public.set_enquiry_outcome(
  p_enquiry_id uuid,
  p_outcome public.enquiry_outcome,
  p_value numeric default null,
  p_reason text default null,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_outcome is null then
    perform private.write_outcome(p_enquiry_id, 'none', null, null, null, null, false);
  elsif p_outcome::text = 'won' then
    perform private.write_outcome(p_enquiry_id, 'won', p_value,
      (now() at time zone 'Europe/Dublin')::date, p_reason, p_note, false);
  else
    perform private.write_outcome(p_enquiry_id, 'lost', p_value, null,
      case when p_reason = 'project_cancelled' then 'other' else p_reason end,
      coalesce(p_note, case when p_reason = 'project_cancelled' then 'Project cancelled' end),
      false);
  end if;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Pilot report: quoted, won and won value beside saved and booked (same splits).
-- Quoted = a quote recorded or the enquiry won. Money appears only in these staff aggregates,
-- never in landing_sessions or any other analytics table.
-- ---------------------------------------------------------------------------------------------

create or replace function public.pilot_report(p_from date, p_to date)
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
           en.landing_session_id, en.outcome, en.outcome_value, en.quote_amount,
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
           count(*) filter (where quote_amount is not null or outcome = 'won') as quoted,
           count(*) filter (where outcome = 'won') as won,
           coalesce(sum(outcome_value) filter (where outcome = 'won'), 0) as won_value,
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
           'quoted', coalesce(enq.quoted, 0),
           'won', coalesce(enq.won, 0),
           'won_value', coalesce(enq.won_value, 0),
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
