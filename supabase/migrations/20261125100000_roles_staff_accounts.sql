-- Slice 5, part 1: roles, staff accounts and who takes bookings.
--
-- Roles: admin | staff (the existing column). Staff handle enquiries, appointments, outcomes and
-- their own calendar connection and availability. Admins also manage people, business settings,
-- wording, limits, retention, deletion and campaign spend. A deactivated person keeps their row
-- (bookings and history refer to it) but every check below treats them as nobody.

-- ---------------------------------------------------------------------------------------------
-- Staff accounts
-- ---------------------------------------------------------------------------------------------

alter table public.staff
  add column email text,
  add column active boolean not null default true,
  add column deactivated_at timestamptz,
  add column updated_at timestamptz not null default now();

update public.staff s set email = lower(u.email) from auth.users u where u.id = s.user_id;

alter table public.staff
  alter column email set not null,
  add constraint staff_email_format check (email = lower(email) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  add constraint staff_deactivated_when_inactive check (active or deactivated_at is not null);

create unique index staff_email_key on public.staff (email);

comment on table public.staff is
  'Who may use the staff workspace. Admins add and deactivate people through the staff-accounts '
  'function; rows are never deleted by the app, so bookings and history keep their names.';

create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.staff where user_id = (select auth.uid()) and active);
$$;

create function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.staff where user_id = (select auth.uid()) and active and role = 'admin'
  );
$$;

revoke all on function public.is_admin() from public, anon, authenticated;
grant execute on function public.is_admin() to authenticated, service_role;

-- Settings that only admins change. Staff may still read them (the screens show them).
drop policy "staff edit appointment types" on public.appointment_types;
create policy "admins edit appointment types" on public.appointment_types
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

drop policy "staff edit booking settings" on public.booking_settings;
create policy "admins edit booking settings" on public.booking_settings
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

-- Availability: an admin edits anyone's, a staff member only their own.
drop policy "staff edit availability" on public.staff_availability;
create policy "admins or the person edit availability" on public.staff_availability
  for update to authenticated
  using ((select public.is_admin()) or ((select public.is_staff()) and staff_user_id = (select auth.uid())))
  with check ((select public.is_admin()) or ((select public.is_staff()) and staff_user_id = (select auth.uid())));

-- Admin only: the retention dry run.
create or replace function public.retention_preview(p_months integer default null)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return (select count(*) from private.retention_candidates(
    coalesce(p_months, (select retention_months from public.booking_settings limit 1))));
end;
$$;

-- Account changes, called by the staff-accounts function (which has checked the caller is an
-- active admin). Guards: never leave the business without an active admin, and never deactivate
-- the person who takes bookings (choose someone else first).
create function private.add_staff(p_user_id uuid, p_email text, p_name text, p_role text)
returns void
language sql
set search_path = ''
as $$
  insert into public.staff (user_id, email, display_name, role)
  values (p_user_id, lower(btrim(p_email)), btrim(p_name), p_role);
$$;

create function private.set_staff_active(p_user_id uuid, p_active boolean)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v public.staff;
begin
  select * into v from public.staff where user_id = p_user_id for update;
  if not found then
    raise exception 'staff member not found' using errcode = 'P0002';
  end if;
  if not p_active then
    if (select bookable_staff_user_id from public.booking_settings limit 1) = p_user_id then
      raise exception 'takes bookings' using errcode = '22023';
    end if;
    if v.role = 'admin' and v.active and (
      select count(*) from public.staff where role = 'admin' and active
    ) <= 1 then
      raise exception 'last admin' using errcode = '22023';
    end if;
  end if;
  update public.staff
  set active = p_active,
      deactivated_at = case when p_active then null else coalesce(deactivated_at, now()) end,
      updated_at = now()
  where user_id = p_user_id;
end;
$$;

create function private.set_staff_role(p_user_id uuid, p_role text)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v public.staff;
begin
  select * into v from public.staff where user_id = p_user_id for update;
  if not found then
    raise exception 'staff member not found' using errcode = 'P0002';
  end if;
  if v.role = 'admin' and p_role <> 'admin' and v.active and (
    select count(*) from public.staff where role = 'admin' and active
  ) <= 1 then
    raise exception 'last admin' using errcode = '22023';
  end if;
  update public.staff set role = p_role, updated_at = now() where user_id = p_user_id;
end;
$$;

-- The active staff member with this email, for "forgot password" (null if none).
create function private.active_staff_by_email(p_email text)
returns uuid
language sql
stable
set search_path = ''
as $$
  select user_id from public.staff where email = lower(btrim(p_email)) and active;
$$;

-- ---------------------------------------------------------------------------------------------
-- Who takes bookings: exactly one person, chosen by an admin. Bookings keep the person (and
-- calendar) they were made with; only new bookings follow the setting.
-- ---------------------------------------------------------------------------------------------

alter table public.booking_settings
  add column bookable_staff_user_id uuid references public.staff (user_id);

update public.booking_settings set bookable_staff_user_id = (select public.bookable_staff());

create or replace function public.bookable_staff()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select s.user_id
  from public.booking_settings b
  join public.staff s on s.user_id = b.bookable_staff_user_id
  join public.staff_availability a on a.staff_user_id = s.user_id
  where s.active
  limit 1;
$$;

create function public.set_bookable_staff(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_previous uuid;
begin
  if not public.is_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if not exists (select 1 from public.staff where user_id = p_user_id and active) then
    raise exception 'not an active staff member' using errcode = '22023';
  end if;
  select bookable_staff_user_id into v_previous from public.booking_settings limit 1 for update;
  -- The new person starts from the previous person's hours (or the placeholder week).
  insert into public.staff_availability
    (staff_user_id, working_hours, min_notice_minutes, horizon_days, daily_visit_limit, slot_step_minutes)
  select p_user_id,
    coalesce(a.working_hours, '{"1":[["09:00","17:00"]],"2":[["09:00","17:00"]],"3":[["09:00","17:00"]],"4":[["09:00","17:00"]],"5":[["09:00","17:00"]]}'::jsonb),
    coalesce(a.min_notice_minutes, 24 * 60), coalesce(a.horizon_days, 21),
    coalesce(a.daily_visit_limit, 3), coalesce(a.slot_step_minutes, 30)
  from (select 1) one
  left join public.staff_availability a on a.staff_user_id = v_previous
  on conflict (staff_user_id) do nothing;
  update public.booking_settings set bookable_staff_user_id = p_user_id, updated_at = now();
end;
$$;

revoke all on function public.set_bookable_staff(uuid) from public, anon, authenticated;
grant execute on function public.set_bookable_staff(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Staff account emails through the communications queue. The set-password link is generated at
-- send time by the worker, so no usable token is ever stored.
-- ---------------------------------------------------------------------------------------------

alter table public.communications
  alter column enquiry_id drop not null,
  add column staff_user_id uuid references public.staff (user_id) on delete cascade,
  drop constraint communications_template_check,
  add constraint communications_template_check check (template in (
    'booking_confirmation', 'booking_reminder', 'booking_cancelled', 'booking_rescheduled',
    'staff_new_enquiry', 'staff_callback_request', 'staff_invite', 'staff_password_reset')),
  add constraint communications_about_check check (
    (template in ('staff_invite', 'staff_password_reset')) = (enquiry_id is null and staff_user_id is not null));

create function private.queue_staff_account_email(p_user_id uuid, p_template text, p_request uuid)
returns void
language sql
set search_path = ''
as $$
  insert into public.communications (staff_user_id, template, recipient, dedupe_key)
  select s.user_id, p_template, s.email, p_template || ':' || s.user_id || ':' || p_request
  from public.staff s
  where s.user_id = p_user_id and s.active
  on conflict (dedupe_key) do nothing;
$$;

create or replace function private.communication_sent(p_id uuid, p_provider_id text)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v public.communications;
begin
  update public.communications
  set state = 'sent', sent_at = now(), provider_message_id = p_provider_id, locked_until = null,
      last_error = null, updated_at = now()
  where id = p_id and state <> 'sent'
  returning * into v;
  if found and v.enquiry_id is not null then
    insert into public.enquiry_events (enquiry_id, kind, booking_id, detail)
    values (v.enquiry_id, 'email_sent', v.booking_id, v.template);
  end if;
end;
$$;

create or replace function private.communication_retry(p_id uuid, p_error text, p_delay_seconds integer, p_final boolean)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v public.communications;
begin
  update public.communications
  set state = case when p_final then 'failed' else 'queued' end,
      last_error = left(p_error, 500),
      next_attempt_at = now() + make_interval(secs => p_delay_seconds),
      locked_until = null,
      updated_at = now()
  where id = p_id
  returning * into v;
  if p_final and v.enquiry_id is not null then
    insert into public.enquiry_events (enquiry_id, kind, booking_id, detail)
    values (v.enquiry_id, 'email_failed', v.booking_id, left(p_error, 300));
  end if;
end;
$$;

-- Alerts go to active staff only.
create or replace function private.queue_staff_alert(p_enquiry_id uuid, p_template text)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.communications (enquiry_id, template, recipient, dedupe_key)
  select p_enquiry_id, p_template, s.email, p_template || ':' || p_enquiry_id || ':' || s.user_id
  from public.staff s
  where s.active
  on conflict (dedupe_key) do nothing;
$$;

-- "Forgot password" requests are limited per address like enquiries.
alter table private.rate_limit_hits drop constraint rate_limit_hits_bucket_check;
alter table private.rate_limit_hits add constraint rate_limit_hits_bucket_check
  check (bucket in ('enquiry', 'booking_write', 'booking_read', 'password_reset'));

-- ---------------------------------------------------------------------------------------------
-- Every staff action requires an active row; deleting an enquiry requires an active admin.
-- (Bodies unchanged apart from that check.)
-- ---------------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.set_enquiry_status(p_enquiry_id uuid, p_status enquiry_status, p_reason text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_name text;
  v_from public.enquiry_status;
  v_reason text := nullif(btrim(p_reason, E' \t\r\n'), '');
begin
  select display_name into v_name from public.staff where user_id = (select auth.uid()) and active;
  if not found then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_status is null then
    raise exception 'status is required' using errcode = '22023';
  end if;
  if p_status = 'unsuitable' and v_reason is null then
    raise exception 'a reason is required to mark an enquiry unsuitable' using errcode = '22023';
  end if;
  if char_length(v_reason) > 500 then
    raise exception 'reason is too long' using errcode = '22023';
  end if;

  select status into v_from from public.enquiries where id = p_enquiry_id for update;
  if not found then
    raise exception 'enquiry not found' using errcode = 'P0002';
  end if;
  if v_from = p_status then
    return;
  end if;

  update public.enquiries
  set status = p_status,
      status_reason = case when p_status = 'unsuitable' then v_reason end,
      updated_at = now()
  where id = p_enquiry_id;

  insert into public.enquiry_events (enquiry_id, kind, from_status, to_status, reason, actor_user_id, actor_name)
  values (p_enquiry_id, 'status_changed', v_from, p_status, v_reason, (select auth.uid()), v_name);
end;
$function$

;

CREATE OR REPLACE FUNCTION public.set_booking_attendance(p_booking_id uuid, p_attendance booking_attendance)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_name text;
  v public.bookings;
begin
  select display_name into v_name from public.staff where user_id = (select auth.uid()) and active;
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
$function$

;

CREATE OR REPLACE FUNCTION public.set_enquiry_outcome(p_enquiry_id uuid, p_outcome enquiry_outcome, p_value numeric DEFAULT NULL::numeric, p_reason text DEFAULT NULL::text, p_note text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_name text;
  v_note text := nullif(btrim(coalesce(p_note, ''), E' \t\r\n'), '');
  v_detail text;
begin
  select display_name into v_name from public.staff where user_id = (select auth.uid()) and active;
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
$function$

;

CREATE OR REPLACE FUNCTION public.delete_enquiry(p_enquiry_id uuid, p_confirm_reference text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_name text;
  v_reference text;
begin
  select display_name into v_name from public.staff where user_id = (select auth.uid()) and active and role = 'admin';
  if not found then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select reference into v_reference from public.enquiries where id = p_enquiry_id;
  if not found then
    raise exception 'enquiry not found' using errcode = 'P0002';
  end if;
  if upper(btrim(coalesce(p_confirm_reference, ''))) <> v_reference then
    raise exception 'type the reference to confirm' using errcode = '22023';
  end if;
  return private.delete_enquiry_data(p_enquiry_id, 'staff_request', v_name);
end;
$function$

;


revoke all on all functions in schema private from public, anon, authenticated;
grant execute on all functions in schema private to service_role;
