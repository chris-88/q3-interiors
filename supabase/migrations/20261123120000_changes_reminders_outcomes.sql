-- Slice 3: cancel and reschedule, reminders, attendance and outcomes, funnel report, calendar
-- reconcile flags. Access model unchanged: anon has no table access; customers act through the
-- public-booking function (enquiry token), staff through staff-booking (staff JWT) or RLS.

-- ---------------------------------------------------------------------------------------------
-- Settings (one row; placeholder values until confirmed with Q3 Interiors)
-- ---------------------------------------------------------------------------------------------

create table public.booking_settings (
  id boolean primary key default true check (id),
  -- Inside this many minutes before the start, customers are asked to ring instead.
  change_cutoff_minutes integer not null default 120 check (change_cutoff_minutes between 0 and 10080),
  -- One reminder email this many minutes before the start.
  reminder_lead_minutes integer not null default 1440 check (reminder_lead_minutes between 30 and 10080),
  -- Shown to customers who are inside the cut-off. PLACEHOLDER: null until confirmed.
  business_phone text check (business_phone is null or char_length(business_phone) between 5 and 40),
  updated_at timestamptz not null default now()
);

comment on table public.booking_settings is
  'Customer change cut-off, reminder lead time and business phone. PLACEHOLDER values.';

insert into public.booking_settings (id) values (true);

-- ---------------------------------------------------------------------------------------------
-- Bookings: cancellation, attendance, reconcile flags
-- ---------------------------------------------------------------------------------------------

create type public.booking_attendance as enum ('attended', 'no_show');

alter table public.bookings
  add column cancelled_at timestamptz,
  add column cancelled_by text check (cancelled_by in ('customer', 'staff')),
  add column cancel_reason text check (cancel_reason is null or char_length(cancel_reason) <= 300),
  add column reschedule_count integer not null default 0,
  add column attendance public.booking_attendance,
  add column attendance_at timestamptz,
  -- Set by the reconcile job when Google no longer matches; it never changes the booking.
  add column calendar_mismatch text,
  add column calendar_mismatch_at timestamptz,
  add column calendar_checked_at timestamptz,
  add constraint bookings_cancelled_has_time check ((state = 'cancelled') = (cancelled_at is not null));

-- ---------------------------------------------------------------------------------------------
-- Jobs: update and delete calendar events (one open job of each kind per booking)
-- ---------------------------------------------------------------------------------------------

alter table public.integration_jobs drop constraint integration_jobs_kind_check;
alter table public.integration_jobs drop constraint integration_jobs_kind_booking_id_key;
alter table public.integration_jobs
  add constraint integration_jobs_kind_check
  check (kind in ('create_calendar_event', 'update_calendar_event', 'delete_calendar_event'));
create unique index integration_jobs_one_create on public.integration_jobs (booking_id)
  where kind = 'create_calendar_event';
create unique index integration_jobs_one_open on public.integration_jobs (kind, booking_id)
  where kind <> 'create_calendar_event' and state in ('queued', 'running');

-- ---------------------------------------------------------------------------------------------
-- Messages: reminder, cancellation, reschedule; 'skipped' for messages made obsolete
-- ---------------------------------------------------------------------------------------------

alter table public.communications drop constraint communications_template_check;
alter table public.communications drop constraint communications_state_check;
alter table public.communications
  add constraint communications_template_check
    check (template in ('booking_confirmation', 'booking_reminder', 'booking_cancelled', 'booking_rescheduled')),
  add constraint communications_state_check
    check (state in ('queued', 'sending', 'sent', 'failed', 'skipped')),
  -- For reminders and reschedule notices: the start time the message is about.
  add column about_start timestamptz;

-- ---------------------------------------------------------------------------------------------
-- Enquiry outcome. Kept apart from enquiry_status on purpose: status is how the enquiry is being
-- handled (new, in review, contacted, unsuitable); the outcome is the commercial result, and an
-- enquiry can be "contacted" and "won" at once. Changes go into the same enquiry_events history.
-- ---------------------------------------------------------------------------------------------

create type public.enquiry_outcome as enum ('won', 'lost');

alter table public.enquiries
  add column outcome public.enquiry_outcome,
  add column outcome_value numeric(12, 2) check (outcome_value is null or outcome_value >= 0),
  add column outcome_reason text check (outcome_reason in (
    'price', 'timing', 'chose_another', 'project_cancelled', 'no_response', 'other')),
  add column outcome_note text check (outcome_note is null or char_length(outcome_note) <= 500),
  add column outcome_at timestamptz,
  add constraint enquiries_outcome_shape check (
    (outcome is null and outcome_value is null and outcome_reason is null and outcome_at is null)
    or (outcome = 'won' and outcome_reason is null and outcome_at is not null)
    or (outcome = 'lost' and outcome_value is null and outcome_reason is not null and outcome_at is not null)
  );

alter table public.enquiry_events drop constraint enquiry_events_kind_check;
alter table public.enquiry_events
  add constraint enquiry_events_kind_check check (kind in (
    'submitted', 'status_changed', 'site_details_added', 'contact_requested',
    'booking_requested', 'booking_confirmed', 'booking_failed', 'booking_retrying',
    'email_sent', 'email_failed',
    'booking_cancelled', 'booking_rescheduled', 'calendar_updated', 'calendar_update_failed',
    'attendance_recorded', 'outcome_recorded', 'outcome_cleared'
  ));

-- ---------------------------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------------------------

create function private.enqueue_calendar_job(p_kind text, p_booking_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
begin
  update public.integration_jobs
  set next_attempt_at = now(), updated_at = now()
  where kind = p_kind and booking_id = p_booking_id and state = 'queued';
  if found then
    return;
  end if;
  if exists (
    select 1 from public.integration_jobs
    where kind = p_kind and booking_id = p_booking_id and state = 'running'
  ) then
    -- The running job re-checks the booking when it finishes (see complete_sync_job).
    return;
  end if;
  insert into public.integration_jobs (kind, booking_id) values (p_kind, p_booking_id)
  on conflict do nothing;
end;
$$;

create function private.skip_open_reminders(p_booking_id uuid, p_reason text)
returns void
language sql
set search_path = ''
as $$
  update public.communications
  set state = 'skipped', last_error = left(p_reason, 300), locked_until = null, updated_at = now()
  where booking_id = p_booking_id and template = 'booking_reminder' and state = 'queued';
$$;

-- ---------------------------------------------------------------------------------------------
-- Cancel and reschedule (callers: public-booking for customers, staff-booking for staff)
-- ---------------------------------------------------------------------------------------------

create function private.cancel_booking(
  p_booking_id uuid, p_actor text, p_reason text, p_actor_user_id uuid default null
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v public.bookings;
  v_actor_name text;
begin
  if p_actor not in ('customer', 'staff') then
    raise exception 'unknown actor' using errcode = '22023';
  end if;
  select * into v from public.bookings where id = p_booking_id for update;
  if not found then
    raise exception 'booking not found' using errcode = 'P0002';
  end if;
  if v.state = 'cancelled' then
    return jsonb_build_object('status', 'cancelled', 'changed', false);
  end if;
  if v.state = 'failed' then
    return jsonb_build_object('status', 'not_live');
  end if;

  update public.bookings
  set state = 'cancelled', cancelled_at = now(), cancelled_by = p_actor,
      cancel_reason = nullif(left(btrim(coalesce(p_reason, '')), 300), ''), updated_at = now()
  where id = p_booking_id;

  -- Removing the event is an external operation: an idempotent job (a no-op if none exists).
  perform private.enqueue_calendar_job('delete_calendar_event', p_booking_id);
  perform private.skip_open_reminders(p_booking_id, 'Booking cancelled');

  insert into public.communications (enquiry_id, booking_id, template, recipient, dedupe_key, about_start)
  select v.enquiry_id, v.id, 'booking_cancelled', e.answers ->> 'email', 'booking_cancelled:' || v.id, v.starts_at
  from public.enquiries e
  where e.id = v.enquiry_id and e.answers ->> 'email' is not null
  on conflict (dedupe_key) do nothing;

  select display_name into v_actor_name from public.staff where user_id = p_actor_user_id;
  insert into public.enquiry_events (enquiry_id, kind, booking_id, detail, actor_user_id, actor_name)
  values (v.enquiry_id, 'booking_cancelled', v.id,
          'Cancelled by ' || p_actor || coalesce(': ' || nullif(btrim(coalesce(p_reason, '')), ''), ''),
          p_actor_user_id, v_actor_name);
  return jsonb_build_object('status', 'cancelled', 'changed', true);
end;
$$;

-- Moves a live booking in one transaction under the overlap constraint. A lost race leaves the
-- old time untouched. The caller has already checked the new slot against hours and free/busy.
create function private.reschedule_booking(
  p_booking_id uuid, p_starts_at timestamptz, p_actor text, p_actor_user_id uuid default null
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v public.bookings;
  v_type public.appointment_types;
  v_avail public.staff_availability;
  v_ends timestamptz;
  v_day date;
  v_count integer;
  v_actor_name text;
begin
  select * into v from public.bookings where id = p_booking_id for update;
  if not found then
    raise exception 'booking not found' using errcode = 'P0002';
  end if;
  if v.state not in ('reserved', 'calendar_pending', 'confirmed') then
    return jsonb_build_object('status', 'not_live');
  end if;
  if v.starts_at = p_starts_at then
    -- A repeated request (double tap): already there.
    return jsonb_build_object('status', 'rescheduled', 'changed', false);
  end if;

  select * into v_type from public.appointment_types where id = v.appointment_type_id;
  select * into v_avail from public.staff_availability where staff_user_id = v.staff_user_id;
  if p_starts_at < now() + make_interval(mins => coalesce(v_avail.min_notice_minutes, 0)) then
    return jsonb_build_object('status', 'slot_unavailable', 'reason', 'notice');
  end if;
  v_ends := p_starts_at + make_interval(mins => v_type.duration_minutes);

  if v_type.mode = 'on_site' then
    v_day := (p_starts_at at time zone 'Europe/Dublin')::date;
    perform pg_advisory_xact_lock(hashtextextended(v.staff_user_id::text || v_day::text, 0));
    select count(*) into v_count
    from public.bookings b
    join public.appointment_types t on t.id = b.appointment_type_id
    where b.staff_user_id = v.staff_user_id and b.id <> v.id and t.mode = 'on_site'
      and b.state in ('reserved', 'calendar_pending', 'confirmed')
      and (b.starts_at at time zone 'Europe/Dublin')::date = v_day;
    if v_count >= v_avail.daily_visit_limit then
      return jsonb_build_object('status', 'slot_unavailable', 'reason', 'daily_limit');
    end if;
  end if;

  begin
    update public.bookings
    set starts_at = p_starts_at,
        ends_at = v_ends,
        blocked = tstzrange(
          p_starts_at - make_interval(mins => v_type.buffer_before_minutes),
          v_ends + make_interval(mins => v_type.buffer_after_minutes)),
        reschedule_count = reschedule_count + 1,
        calendar_mismatch = null,
        calendar_mismatch_at = null,
        updated_at = now()
    where id = p_booking_id;
  exception when exclusion_violation then
    return jsonb_build_object('status', 'slot_unavailable', 'reason', 'taken');
  end;

  perform private.enqueue_calendar_job('update_calendar_event', p_booking_id);
  perform private.skip_open_reminders(p_booking_id, 'Booking moved');

  insert into public.communications (enquiry_id, booking_id, template, recipient, dedupe_key, about_start)
  select v.enquiry_id, v.id, 'booking_rescheduled', e.answers ->> 'email',
         'booking_rescheduled:' || v.id || ':' || extract(epoch from p_starts_at)::bigint, p_starts_at
  from public.enquiries e
  where e.id = v.enquiry_id and e.answers ->> 'email' is not null
  on conflict (dedupe_key) do nothing;

  select display_name into v_actor_name from public.staff where user_id = p_actor_user_id;
  insert into public.enquiry_events (enquiry_id, kind, booking_id, detail, actor_user_id, actor_name)
  values (v.enquiry_id, 'booking_rescheduled', v.id,
          'Moved by ' || p_actor || ' from '
            || to_char(v.starts_at at time zone 'Europe/Dublin', 'Dy DD Mon HH24:MI') || ' to '
            || to_char(p_starts_at at time zone 'Europe/Dublin', 'Dy DD Mon HH24:MI'),
          p_actor_user_id, v_actor_name);
  return jsonb_build_object('status', 'rescheduled', 'changed', true);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Calendar sync jobs (update/delete) and reconcile
-- ---------------------------------------------------------------------------------------------

create function private.claim_sync_jobs(p_limit integer, p_booking_id uuid default null)
returns setof public.integration_jobs
language sql
set search_path = ''
as $$
  update public.integration_jobs j
  set state = 'running', attempts = j.attempts + 1,
      locked_until = now() + interval '2 minutes', updated_at = now()
  where j.id in (
    select id from public.integration_jobs
    where kind in ('update_calendar_event', 'delete_calendar_event')
      and (p_booking_id is null or booking_id = p_booking_id)
      and ((state = 'queued' and next_attempt_at <= now())
        or (state = 'running' and locked_until < now()))
    order by next_attempt_at
    for update skip locked
    limit p_limit
  )
  returning j.*;
$$;

-- Done. For an update, p_synced_start is the start written to Google; if the booking moved
-- again meanwhile, the job goes back in the queue instead of finishing.
create function private.complete_sync_job(p_job_id bigint, p_synced_start timestamptz, p_detail text)
returns void
language plpgsql
set search_path = ''
as $$
declare
  j public.integration_jobs;
  b public.bookings;
begin
  select * into j from public.integration_jobs where id = p_job_id for update;
  select * into b from public.bookings where id = j.booking_id;
  if j.kind = 'update_calendar_event' and p_synced_start is not null and b.starts_at <> p_synced_start then
    update public.integration_jobs
    set state = 'queued', next_attempt_at = now(), locked_until = null, updated_at = now()
    where id = p_job_id;
    return;
  end if;
  update public.integration_jobs
  set state = 'succeeded', locked_until = null, last_error = null, external_id = b.calendar_event_id,
      updated_at = now()
  where id = p_job_id;
  if j.kind = 'update_calendar_event' then
    update public.bookings set calendar_mismatch = null, calendar_mismatch_at = null, calendar_checked_at = now()
    where id = b.id;
    insert into public.enquiry_events (enquiry_id, kind, booking_id, detail)
    values (b.enquiry_id, 'calendar_updated', b.id, left(p_detail, 300));
  end if;
end;
$$;

create function private.retry_sync_job(p_job_id bigint, p_error text, p_delay_seconds integer)
returns void
language sql
set search_path = ''
as $$
  update public.integration_jobs
  set state = 'queued', locked_until = null, last_error = left(p_error, 500),
      next_attempt_at = now() + make_interval(secs => p_delay_seconds), updated_at = now()
  where id = p_job_id;
$$;

-- An update that never reached Google lands in needs-attention; the database time stays true.
create function private.fail_sync_job(p_job_id bigint, p_error text)
returns void
language plpgsql
set search_path = ''
as $$
declare
  j public.integration_jobs;
  b public.bookings;
begin
  update public.integration_jobs
  set state = 'failed', locked_until = null, last_error = left(p_error, 500), updated_at = now()
  where id = p_job_id
  returning * into j;
  select * into b from public.bookings where id = j.booking_id;
  if j.kind = 'update_calendar_event' then
    update public.bookings
    set calendar_mismatch = 'Could not move the Google Calendar event: ' || left(p_error, 300),
        calendar_mismatch_at = now()
    where id = b.id;
  end if;
  insert into public.enquiry_events (enquiry_id, kind, booking_id, detail)
  values (b.enquiry_id, 'calendar_update_failed', b.id,
          case j.kind when 'delete_calendar_event' then 'Could not remove the Google Calendar event: '
                      else 'Could not move the Google Calendar event: ' end || left(p_error, 300));
end;
$$;

-- Confirmed, upcoming bookings due a check against Google (at most every 30 minutes each), with
-- no calendar job of their own still open.
create function private.bookings_to_reconcile(p_limit integer)
returns setof public.bookings
language sql
stable
set search_path = ''
as $$
  select b.* from public.bookings b
  where b.state = 'confirmed' and b.ends_at > now()
    and (b.calendar_checked_at is null or b.calendar_checked_at < now() - interval '30 minutes')
    and not exists (
      select 1 from public.integration_jobs j
      where j.booking_id = b.id and j.state in ('queued', 'running'))
  order by b.calendar_checked_at nulls first, b.starts_at
  limit p_limit;
$$;

create function private.record_reconcile(p_booking_id uuid, p_mismatch text)
returns void
language sql
set search_path = ''
as $$
  update public.bookings
  set calendar_checked_at = now(),
      calendar_mismatch = p_mismatch,
      calendar_mismatch_at = case
        when p_mismatch is null then null
        when calendar_mismatch is distinct from p_mismatch then now()
        else calendar_mismatch_at end
  where id = p_booking_id;
$$;

-- The create job guards against a booking that was cancelled while it ran.
create or replace function private.complete_calendar_job(p_job_id bigint, p_event_link text)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_job public.integration_jobs;
  v_booking public.bookings;
  v_email text;
begin
  select * into v_job from public.integration_jobs where id = p_job_id for update;
  if v_job.state = 'succeeded' then
    return;
  end if;
  update public.integration_jobs
  set state = 'succeeded', locked_until = null, last_error = null, updated_at = now(),
      external_id = (select calendar_event_id from public.bookings where id = v_job.booking_id)
  where id = p_job_id;

  select * into v_booking from public.bookings where id = v_job.booking_id for update;
  if v_booking.state = 'cancelled' then
    -- Cancelled while the event was being created: make sure the event goes again.
    perform private.enqueue_calendar_job('delete_calendar_event', v_booking.id);
    return;
  end if;

  update public.bookings
  set state = 'confirmed', confirmed_at = now(), calendar_event_link = p_event_link,
      failure_reason = null, updated_at = now()
  where id = v_job.booking_id
  returning * into v_booking;

  insert into public.enquiry_events (enquiry_id, kind, booking_id)
  values (v_booking.enquiry_id, 'booking_confirmed', v_booking.id);

  select answers ->> 'email' into v_email from public.enquiries where id = v_booking.enquiry_id;
  if v_email is not null then
    insert into public.communications (enquiry_id, booking_id, template, recipient, dedupe_key)
    values (v_booking.enquiry_id, v_booking.id, 'booking_confirmation', v_email,
            'booking_confirmation:' || v_booking.id)
    on conflict (dedupe_key) do nothing;
  end if;

  update public.calendar_connections
  set last_success_at = now(), updated_at = now()
  where staff_user_id = v_booking.staff_user_id;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Reminders: the plan (when, or not at all) is decided in the functions (reminders.ts); this
-- stores it. Exactly once per booking and start time through the dedupe key.
-- ---------------------------------------------------------------------------------------------

create function private.schedule_reminder(p_booking_id uuid, p_planned_at timestamptz)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v public.bookings;
begin
  select * into v from public.bookings where id = p_booking_id;
  if v.state <> 'confirmed' then
    return;
  end if;
  insert into public.communications
    (enquiry_id, booking_id, template, recipient, dedupe_key, planned_at, next_attempt_at, about_start)
  select v.enquiry_id, v.id, 'booking_reminder', e.answers ->> 'email',
         'booking_reminder:' || v.id || ':' || extract(epoch from v.starts_at)::bigint,
         p_planned_at, p_planned_at, v.starts_at
  from public.enquiries e
  where e.id = v.enquiry_id and e.answers ->> 'email' is not null
  on conflict (dedupe_key) do nothing;
end;
$$;

create function private.communication_skipped(p_id uuid, p_reason text)
returns void
language sql
set search_path = ''
as $$
  update public.communications
  set state = 'skipped', last_error = left(p_reason, 300), locked_until = null, updated_at = now()
  where id = p_id and state <> 'sent';
$$;

-- ---------------------------------------------------------------------------------------------
-- Staff: attendance and outcome (same history as status changes)
-- ---------------------------------------------------------------------------------------------

create function public.set_booking_attendance(p_booking_id uuid, p_attendance public.booking_attendance)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
  v public.bookings;
begin
  select display_name into v_name from public.staff where user_id = (select auth.uid());
  if not found then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select * into v from public.bookings where id = p_booking_id for update;
  if not found then
    raise exception 'booking not found' using errcode = 'P0002';
  end if;
  if v.state <> 'confirmed' then
    raise exception 'only a confirmed appointment can be marked' using errcode = '22023';
  end if;
  if v.starts_at > now() then
    raise exception 'the appointment has not started yet' using errcode = '22023';
  end if;
  if v.attendance is not distinct from p_attendance then
    return;
  end if;
  update public.bookings set attendance = p_attendance, attendance_at = now(), updated_at = now()
  where id = p_booking_id;
  insert into public.enquiry_events (enquiry_id, kind, booking_id, detail, actor_user_id, actor_name)
  values (v.enquiry_id, 'attendance_recorded', v.id,
          case p_attendance when 'attended' then 'Attended' else 'No-show' end,
          (select auth.uid()), v_name);
end;
$$;

create function public.set_enquiry_outcome(
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
declare
  v_name text;
  v_note text := nullif(btrim(coalesce(p_note, ''), E' \t\r\n'), '');
  v_detail text;
begin
  select display_name into v_name from public.staff where user_id = (select auth.uid());
  if not found then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  perform 1 from public.enquiries where id = p_enquiry_id for update;
  if not found then
    raise exception 'enquiry not found' using errcode = 'P0002';
  end if;

  if p_outcome is null then
    update public.enquiries
    set outcome = null, outcome_value = null, outcome_reason = null, outcome_note = null,
        outcome_at = null, updated_at = now()
    where id = p_enquiry_id;
    insert into public.enquiry_events (enquiry_id, kind, actor_user_id, actor_name)
    values (p_enquiry_id, 'outcome_cleared', (select auth.uid()), v_name);
    return;
  end if;
  if p_outcome = 'won' and p_reason is not null then
    raise exception 'a won enquiry has no lost reason' using errcode = '22023';
  end if;
  if p_outcome = 'lost' and (p_reason is null or p_value is not null) then
    raise exception 'a lost enquiry needs a reason and no value' using errcode = '22023';
  end if;
  if p_reason = 'other' and v_note is null then
    raise exception 'say why' using errcode = '22023';
  end if;

  update public.enquiries
  set outcome = p_outcome, outcome_value = p_value, outcome_reason = p_reason,
      outcome_note = v_note, outcome_at = now(), updated_at = now()
  where id = p_enquiry_id;

  v_detail := case p_outcome
    when 'won' then 'Won' || coalesce(', quoted €' || to_char(p_value, 'FM999G999G990D00'), '')
    else 'Lost: ' || replace(p_reason, '_', ' ') end
    || coalesce(' (' || v_note || ')', '');
  insert into public.enquiry_events (enquiry_id, kind, detail, actor_user_id, actor_name)
  values (p_enquiry_id, 'outcome_recorded', left(v_detail, 600), (select auth.uid()), v_name);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Funnel report: staff only. Enquiries submitted in [p_from, p_to] (Irish dates), grouped by
-- campaign; 'booked' = an appointment that reached confirmed (even if later cancelled).
-- ---------------------------------------------------------------------------------------------

create function public.funnel_report(p_from date, p_to date)
returns table (
  campaign text,
  enquiries bigint,
  booked bigint,
  attended bigint,
  won bigint,
  cancelled bigint,
  no_shows bigint,
  won_value numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_staff() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 3660 then
    raise exception 'invalid date range' using errcode = '22023';
  end if;
  return query
  with e as (
    select en.id, en.outcome, en.outcome_value,
           coalesce(nullif(a.utm_campaign, ''), '(unknown)') as campaign
    from public.enquiries en
    left join public.enquiry_attribution a on a.enquiry_id = en.id
    where (en.submitted_at at time zone 'Europe/Dublin')::date between p_from and p_to
  ),
  b as (
    select bk.enquiry_id,
           bool_or(bk.confirmed_at is not null) as booked,
           bool_or(bk.attendance = 'attended') as attended,
           count(*) filter (where bk.state = 'cancelled' and bk.confirmed_at is not null) as cancelled,
           count(*) filter (where bk.attendance = 'no_show') as no_shows
    from public.bookings bk
    where bk.enquiry_id in (select id from e)
    group by bk.enquiry_id
  )
  select e.campaign,
         count(*)::bigint,
         count(*) filter (where b.booked)::bigint,
         count(*) filter (where b.attended)::bigint,
         count(*) filter (where e.outcome = 'won')::bigint,
         coalesce(sum(b.cancelled), 0)::bigint,
         coalesce(sum(b.no_shows), 0)::bigint,
         coalesce(sum(e.outcome_value) filter (where e.outcome = 'won'), 0)
  from e left join b on b.enquiry_id = e.id
  group by e.campaign
  order by count(*) desc, e.campaign;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Privileges and RLS
-- ---------------------------------------------------------------------------------------------

revoke all on table public.booking_settings from public, anon, authenticated;
grant select on table public.booking_settings to authenticated;
grant update (change_cutoff_minutes, reminder_lead_minutes, business_phone, updated_at)
  on public.booking_settings to authenticated;
grant select, insert, update, delete on table public.booking_settings to service_role;
alter table public.booking_settings enable row level security;
create policy "staff read booking settings" on public.booking_settings
  for select to authenticated using ((select public.is_staff()));
create policy "staff edit booking settings" on public.booking_settings
  for update to authenticated using ((select public.is_staff())) with check ((select public.is_staff()));

revoke all on all functions in schema private from public, anon, authenticated;
grant execute on all functions in schema private to service_role;

revoke all on function public.set_booking_attendance(uuid, public.booking_attendance) from public, anon, authenticated;
revoke all on function public.set_enquiry_outcome(uuid, public.enquiry_outcome, numeric, text, text) from public, anon, authenticated;
revoke all on function public.funnel_report(date, date) from public, anon, authenticated;
grant execute on function public.set_booking_attendance(uuid, public.booking_attendance) to authenticated;
grant execute on function public.set_enquiry_outcome(uuid, public.enquiry_outcome, numeric, text, text) to authenticated;
grant execute on function public.funnel_report(date, date) to authenticated;
