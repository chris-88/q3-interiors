-- Slice 5, part 5: the go-live checklist, admin ticks, the test-calendar flag, abuse limits an
-- admin may change (within sane bounds), and the end of booking_settings.business_phone (the
-- functions read the contact phone from business_details since part 2).

alter table public.booking_settings drop column business_phone;

-- Sane bounds for the limits now that an admin can change them in Settings > Advanced.
alter table public.booking_settings
  drop constraint booking_settings_enquiry_limit_per_hour_check,
  drop constraint booking_settings_booking_write_limit_per_hour_check,
  drop constraint booking_settings_booking_read_limit_per_hour_check,
  add constraint booking_settings_enquiry_limit_per_hour_check check (enquiry_limit_per_hour between 1 and 100),
  add constraint booking_settings_booking_write_limit_per_hour_check check (booking_write_limit_per_hour between 5 and 500),
  add constraint booking_settings_booking_read_limit_per_hour_check check (booking_read_limit_per_hour between 50 and 5000);

grant update (enquiry_limit_per_hour, booking_write_limit_per_hour, booking_read_limit_per_hour)
  on public.booking_settings to authenticated;

-- Admin ticks for what the system cannot see, and the address of the test Google account.
create table public.setup_ticks (
  key text primary key check (key in (
    'types_hours_reviewed', 'google_app_production', 'bookings_forwarder', 'phone_check')),
  ticked_at timestamptz not null default now(),
  ticked_by_name text
);

create table public.setup_state (
  id boolean primary key default true check (id),
  -- The Google account used while testing; the checklist stays amber while bookings use it.
  test_calendar_email text check (test_calendar_email is null or char_length(test_calendar_email) <= 254),
  updated_at timestamptz not null default now()
);
insert into public.setup_state (id) values (true);

revoke all on table public.setup_ticks, public.setup_state from public, anon, authenticated;
grant select, insert, delete on table public.setup_ticks to authenticated;
grant select on table public.setup_state to authenticated;
grant select, insert, update, delete on table public.setup_ticks, public.setup_state to service_role;
alter table public.setup_ticks enable row level security;
alter table public.setup_state enable row level security;
create policy "admins read ticks" on public.setup_ticks
  for select to authenticated using ((select public.is_admin()));
create policy "admins tick" on public.setup_ticks
  for insert to authenticated with check ((select public.is_admin()));
create policy "admins untick" on public.setup_ticks
  for delete to authenticated using ((select public.is_admin()));
create policy "admins read setup state" on public.setup_state
  for select to authenticated using ((select public.is_admin()));

-- "The calendar connected now is the test account" (or clear the flag with p_clear).
create function public.mark_test_calendar(p_clear boolean default false)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text;
begin
  if not public.is_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if not p_clear then
    select c.google_email into v_email
    from public.calendar_connections c
    where c.staff_user_id = public.bookable_staff() and c.status = 'connected';
    if v_email is null then
      raise exception 'no connected calendar' using errcode = '22023';
    end if;
  end if;
  update public.setup_state set test_calendar_email = v_email, updated_at = now();
  return v_email;
end;
$$;

-- Everything the system can check, in one call. Admins only.
create function public.go_live_checklist()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  b public.business_details;
  v_bookable uuid := public.bookable_staff();
  v_conn public.calendar_connections;
  v_test text;
  v_form integer;
begin
  if not public.is_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select * into b from public.business_details limit 1;
  select * into v_conn from public.calendar_connections where staff_user_id = v_bookable;
  select test_calendar_email into v_test from public.setup_state limit 1;
  select max(version) into v_form from public.form_versions where form_id = 'enquiry';
  return jsonb_build_object(
    'business_missing', to_jsonb(array_remove(array[
      case when b.legal_name is null then 'legal name' end,
      case when b.postal_address is null then 'postal address' end,
      case when b.contact_phone is null then 'contact phone' end,
      case when b.contact_email is null then 'contact email' end,
      case when b.service_area is null then 'service area' end,
      case when b.privacy_contact is null then 'privacy contact' end], null)),
    'bookable_name', (select display_name from public.staff where user_id = v_bookable),
    'calendar_connected', coalesce(v_conn.status = 'connected', false),
    'calendar_healthy', coalesce(v_conn.status = 'connected' and (v_conn.last_error_at is null
      or v_conn.last_success_at > v_conn.last_error_at), false),
    'calendar_email', v_conn.google_email,
    'test_calendar_email', v_test,
    'retention_months', (select retention_months from public.booking_settings limit 1),
    'privacy_reviewed', b.privacy_reviewed_at is not null,
    'privacy_reviewable', b.legal_name is not null and b.postal_address is not null and b.privacy_contact is not null,
    'form_version', v_form,
    'last_booking_at', (select max(confirmed_at) from public.bookings where confirmed_at > now() - interval '7 days'),
    'campaign_links', (select count(*) from public.campaigns where archived_at is null and link_used_at is not null),
    'ticks', coalesce((select jsonb_object_agg(key, jsonb_build_object('at', ticked_at, 'by', ticked_by_name))
                       from public.setup_ticks), '{}'::jsonb));
end;
$$;

revoke all on function public.mark_test_calendar(boolean) from public, anon, authenticated;
revoke all on function public.go_live_checklist() from public, anon, authenticated;
grant execute on function public.mark_test_calendar(boolean) to authenticated;
grant execute on function public.go_live_checklist() to authenticated;
