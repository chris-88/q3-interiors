-- Fix: claim_calendar_jobs (slice 2) claimed every job kind. Since slice 3 added update and
-- delete jobs, the create-job path could claim one of those and mark it done without moving or
-- removing the Google event (found in live verification on 2026-11-23). Create jobs only now,
-- and completing a create job refuses any other kind.

create or replace function private.claim_calendar_jobs(p_limit integer, p_booking_id uuid default null)
returns setof public.integration_jobs
language sql
set search_path = ''
as $$
  update public.integration_jobs j
  set state = 'running',
      attempts = j.attempts + 1,
      locked_until = now() + interval '2 minutes',
      updated_at = now()
  where j.id in (
    select id from public.integration_jobs
    where kind = 'create_calendar_event'
      and (p_booking_id is null or booking_id = p_booking_id)
      and ((state = 'queued' and next_attempt_at <= now())
        or (state = 'running' and locked_until < now()))
    order by next_attempt_at
    for update skip locked
    limit p_limit
  )
  returning j.*;
$$;

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
  if v_job.kind <> 'create_calendar_event' then
    raise exception 'job % is a %, not a create job', p_job_id, v_job.kind using errcode = '22023';
  end if;
  if v_job.state = 'succeeded' then
    return;
  end if;
  update public.integration_jobs
  set state = 'succeeded', locked_until = null, last_error = null, updated_at = now(),
      external_id = (select calendar_event_id from public.bookings where id = v_job.booking_id)
  where id = p_job_id;

  select * into v_booking from public.bookings where id = v_job.booking_id for update;
  if v_booking.state = 'cancelled' then
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

revoke all on function private.claim_calendar_jobs(integer, uuid) from public, anon, authenticated;
revoke all on function private.complete_calendar_job(bigint, text) from public, anon, authenticated;
grant execute on function private.claim_calendar_jobs(integer, uuid) to service_role;
grant execute on function private.complete_calendar_job(bigint, text) to service_role;
