-- Staff book a call for a customer (2026-11-30), mirroring "Book the site visit" after a call:
-- the staff-booking function's `call_options` / `book_call` actions reserve through the same
-- path as the customer (private.reserve_booking), so the calendar event and the normal
-- confirmation email follow. This adds only the history line. No new function anon can run.
--
-- The kind list repeats every kind up to the quotes release (20261129160000) and adds one.

alter table public.enquiry_events drop constraint enquiry_events_kind_check;
alter table public.enquiry_events
  add constraint enquiry_events_kind_check check (kind in (
    'submitted', 'status_changed', 'site_details_added', 'contact_requested',
    'booking_requested', 'booking_confirmed', 'booking_failed', 'booking_retrying',
    'email_sent', 'email_failed',
    'booking_cancelled', 'booking_rescheduled', 'calendar_updated', 'calendar_update_failed',
    'attendance_recorded', 'outcome_recorded', 'outcome_cleared',
    'details_updated', 'prepare_updated', 'photo_added', 'photo_removed',
    'chase_flagged', 'chase_updated', 'chase_cleared',
    'note_added',
    'estimate_sent', 'quote_requested',
    'call_held_early', 'visit_link_sent', 'visit_booked_by_staff',
    'quote_sent', 'quote_change_requested',
    'call_booked_by_staff'
  ));

-- Called by the staff-booking function (as postgres) after it reserved a call for the customer.
create function private.call_booked_by_staff(p_booking_id uuid, p_actor_user_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v public.bookings;
  v_name text;
begin
  select * into v from public.bookings where id = p_booking_id;
  if not found then
    raise exception 'booking not found' using errcode = 'P0002';
  end if;
  select display_name into v_name from public.staff where user_id = p_actor_user_id;
  insert into public.enquiry_events (enquiry_id, kind, booking_id, detail, actor_user_id, actor_name)
  values (v.enquiry_id, 'call_booked_by_staff', v.id,
          'Call booked for the customer at ' ||
            to_char(v.starts_at at time zone 'Europe/Dublin', 'FMDy FMDD Mon, HH24:MI'),
          p_actor_user_id, v_name);
end;
$$;

revoke all on function private.call_booked_by_staff(uuid, uuid) from public, anon, authenticated;
