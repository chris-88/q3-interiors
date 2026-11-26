-- Staff notes on an enquiry (staff redesign, 2026-11-28). Until now a note could only ride on a
-- status change (set_enquiry_status ignores a note when the status stays the same), so there was
-- no way to write down "rang, no answer" on its own. A note is one enquiry_events row of the new
-- kind 'note_added' (text in detail, author snapshotted): no new table, and consoles built before
-- this release show it as a plain "Update recorded" line with the text.

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
    'note_added'
  ));

-- Any active staff member; 1 to 1,000 characters after trimming.
create function public.add_enquiry_note(p_enquiry_id uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
  v_note text := nullif(btrim(coalesce(p_note, ''), E' \t\r\n'), '');
begin
  if not public.is_staff() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if v_note is null or char_length(v_note) > 1000 then
    raise exception 'write a note of up to 1,000 characters' using errcode = '22023';
  end if;
  select display_name into v_name from public.staff where user_id = (select auth.uid());
  perform 1 from public.enquiries where id = p_enquiry_id for update;
  if not found then
    raise exception 'enquiry not found' using errcode = 'P0002';
  end if;
  insert into public.enquiry_events (enquiry_id, kind, detail, actor_user_id, actor_name)
  values (p_enquiry_id, 'note_added', v_note, (select auth.uid()), v_name);
  update public.enquiries set updated_at = now() where id = p_enquiry_id;
end;
$$;

revoke all on function public.add_enquiry_note(uuid, text) from public, anon, authenticated;
grant execute on function public.add_enquiry_note(uuid, text) to authenticated;
