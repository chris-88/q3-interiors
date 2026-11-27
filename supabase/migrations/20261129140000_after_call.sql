-- Moving a customer on after the introductory call.
--
-- 1. "We already spoke": customers often ring before their booked call. Staff record the call as
--    held today (enquiries.call_held_at); the scheduled call is cancelled (slot and calendar event
--    freed, reminder skipped) with NO cancellation email. Also allowed with no call booked.
-- 2. Once a call is held (attended at its time, or held early), three next steps:
--    a. an estimate straight from the call (send_estimate accepts it; estimates.after = 'call',
--       with its own caveats block, estimate_call_caveats);
--    b. staff book the site visit for the customer (the staff-booking function, through the same
--       reserve path the customer uses; event visit_booked_by_staff);
--    c. a booking link emailed to the customer (send_visit_link; template visit_link).
-- 3. A past appointment with its attendance recorded no longer counts as the enquiry's one live
--    booking, so a held call can be followed by a site visit.

alter table public.enquiries
  add column call_held_at timestamptz,
  add column visit_link_sent_at timestamptz;

comment on column public.enquiries.call_held_at is
  'When staff recorded "We already spoke" (the call held early, or without a booking).';
comment on column public.enquiries.visit_link_sent_at is
  'When the latest "Book your site visit" link was emailed to the customer.';

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
    'call_held_early', 'visit_link_sent', 'visit_booked_by_staff'
  ));

alter table public.communications
  drop constraint communications_template_check,
  add constraint communications_template_check check (template in (
    'booking_confirmation', 'booking_reminder', 'booking_cancelled', 'booking_rescheduled',
    'staff_new_enquiry', 'staff_callback_request', 'staff_invite', 'staff_password_reset',
    'estimate', 'staff_quote_request', 'visit_link'));

-- One live booking per enquiry, but a past appointment whose attendance is recorded is done.
drop index public.bookings_one_live_per_enquiry;
create unique index bookings_one_live_per_enquiry on public.bookings (enquiry_id)
  where state in ('reserved', 'calendar_pending', 'confirmed') and attendance is null;

-- ---------------------------------------------------------------------------------------------
-- "We already spoke"
-- ---------------------------------------------------------------------------------------------

create function public.record_call_held_early(p_enquiry_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
  v_enquiry public.enquiries;
  v_b public.bookings;
  v_when text;
  v_cancelled integer := 0;
begin
  if not public.is_staff() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select display_name into v_name from public.staff where user_id = (select auth.uid());
  select * into v_enquiry from public.enquiries where id = p_enquiry_id for update;
  if not found then
    raise exception 'enquiry not found' using errcode = 'P0002';
  end if;
  if exists (
    select 1 from public.bookings b join public.appointment_types t on t.id = b.appointment_type_id
    where b.enquiry_id = p_enquiry_id and t.mode = 'on_site' and b.starts_at > now()
      and b.state in ('reserved', 'calendar_pending', 'confirmed')
  ) then
    raise exception 'site visit booked' using errcode = '22023';
  end if;

  -- The call still to come: cancelled quietly (no communication is queued).
  for v_b in
    select b.* from public.bookings b join public.appointment_types t on t.id = b.appointment_type_id
    where b.enquiry_id = p_enquiry_id and t.mode = 'phone' and b.starts_at > now()
      and b.state in ('reserved', 'calendar_pending', 'confirmed')
    for update of b
  loop
    update public.bookings
    set state = 'cancelled', cancelled_at = now(), cancelled_by = 'staff',
        cancel_reason = 'Spoke before the call', updated_at = now()
    where id = v_b.id;
    perform private.enqueue_calendar_job('delete_calendar_event', v_b.id);
    perform private.skip_open_reminders(v_b.id, 'Spoke before the call');
    v_when := to_char(v_b.starts_at at time zone 'Europe/Dublin', 'FMDy FMDD Mon, HH24:MI');
    insert into public.enquiry_events (enquiry_id, kind, booking_id, detail, actor_user_id, actor_name)
    values (p_enquiry_id, 'booking_cancelled', v_b.id,
            'Cancelled by staff: spoke before the call (no email to the customer)',
            (select auth.uid()), v_name);
    v_cancelled := v_cancelled + 1;
  end loop;

  update public.enquiries set call_held_at = now(), updated_at = now() where id = p_enquiry_id;
  insert into public.enquiry_events (enquiry_id, kind, detail, actor_user_id, actor_name)
  values (p_enquiry_id, 'call_held_early',
          case when v_cancelled > 0
               then 'Spoke before the call; the call on ' || v_when || ' was cancelled, no email sent'
               else 'Spoke with the customer; no call was booked' end,
          (select auth.uid()), v_name);
  return jsonb_build_object('cancelled', v_cancelled);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- "Send a booking link"
-- ---------------------------------------------------------------------------------------------

create function public.send_visit_link(p_enquiry_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
  v_email text;
begin
  if not public.is_staff() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select display_name into v_name from public.staff where user_id = (select auth.uid());
  select nullif(btrim(answers ->> 'email'), '') into v_email
  from public.enquiries where id = p_enquiry_id for update;
  if not found then
    raise exception 'enquiry not found' using errcode = 'P0002';
  end if;
  if v_email is null then
    raise exception 'no email address' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.bookings b join public.appointment_types t on t.id = b.appointment_type_id
    where b.enquiry_id = p_enquiry_id and t.mode = 'on_site' and b.starts_at > now()
      and b.state in ('reserved', 'calendar_pending', 'confirmed')
  ) then
    raise exception 'site visit booked' using errcode = '22023';
  end if;

  update public.enquiries set visit_link_sent_at = now(), updated_at = now() where id = p_enquiry_id;
  -- One per press (a second press sends the link again); the token is minted when it is sent.
  insert into public.communications (enquiry_id, template, recipient, dedupe_key)
  values (p_enquiry_id, 'visit_link', v_email,
          'visit_link:' || p_enquiry_id || ':' || (extract(epoch from clock_timestamp()) * 1000)::bigint);
  insert into public.enquiry_events (enquiry_id, kind, detail, actor_user_id, actor_name)
  values (p_enquiry_id, 'visit_link_sent', 'Site visit booking link emailed to the customer',
          (select auth.uid()), v_name);
end;
$$;

-- Called by the staff-booking function (as postgres) after it reserved a visit for the customer.
create function private.visit_booked_by_staff(p_booking_id uuid, p_actor_user_id uuid, p_address_added boolean)
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
  values (v.enquiry_id, 'visit_booked_by_staff', v.id,
          'Site visit booked for the customer at ' ||
            to_char(v.starts_at at time zone 'Europe/Dublin', 'FMDy FMDD Mon, HH24:MI') ||
            case when p_address_added then '; address entered by staff' else '' end,
          p_actor_user_id, v_name);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Estimates straight from a call
-- ---------------------------------------------------------------------------------------------

alter table public.estimates
  add column after text not null default 'visit' check (after in ('visit', 'call'));
comment on column public.estimates.after is 'What the estimate followed: a site visit or a call.';

-- The after-a-call caveats' default; the same text as WORDING.estimate_call_caveats in
-- supabase/functions/_shared/messages.ts (a unit test compares them).
create function private.estimate_call_caveats_default()
returns text
language sql
immutable
set search_path = ''
as $$
  select 'This is an estimate, not a quote. It’s a price range based on what you told us on the call, with VAT included. It could change once we see the space, or if the scope changes. It’s good for 10 days. If you want to go ahead, tell us and we’ll send your quote: one price, with what’s included and what isn’t.'::text;
$$;

-- send_estimate gains p_enquiry_id (defaulted): with no booking, an enquiry whose call was held
-- early. A booking may now also be a call that was attended.
drop function public.send_estimate(uuid, integer, numeric, text, text[]);

create function public.send_estimate(
  p_booking_id uuid,
  p_price integer,
  p_percent numeric,
  p_work text,
  p_items text[] default '{}',
  p_enquiry_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_booking public.bookings;
  v_enquiry_id uuid;
  v_mode text;
  v_after text;
  v_email text;
  v_name text;
  v_note text := nullif(btrim(coalesce(p_work, ''), E' \t\r\n'), '');
  v_items text[] := '{}';
  v_item text;
  v_caveats text;
  v_low integer;
  v_high integer;
  v_id uuid;
  v_at timestamptz := now();
begin
  if not public.is_staff() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_price is null or p_price not between 100 and 10000000 then
    raise exception 'price' using errcode = '22023';
  end if;
  if p_percent is null or p_percent not between 0 and 30 or (p_percent * 2) <> trunc(p_percent * 2) then
    raise exception 'percent' using errcode = '22023';
  end if;
  -- Items: trimmed, 2 to 60 characters, no repeats (any case), at most 40, in the order given.
  if cardinality(coalesce(p_items, '{}')) > 40 then
    raise exception 'work items' using errcode = '22023';
  end if;
  foreach v_item in array coalesce(p_items, '{}') loop
    v_item := regexp_replace(btrim(coalesce(v_item, ''), E' \t\r\n'), '\s+', ' ', 'g');
    if char_length(v_item) not between 2 and 60
       or exists (select 1 from unnest(v_items) x where lower(x) = lower(v_item)) then
      raise exception 'work items' using errcode = '22023';
    end if;
    v_items := v_items || v_item;
  end loop;
  if v_note is not null and char_length(v_note) > 600 then
    raise exception 'work looked at' using errcode = '22023';
  end if;
  if cardinality(v_items) = 0 and v_note is null then
    raise exception 'work looked at' using errcode = '22023';
  end if;

  if p_booking_id is not null then
    select b.* into v_booking from public.bookings b where b.id = p_booking_id for update;
    if not found then
      raise exception 'appointment not found' using errcode = 'P0002';
    end if;
    if p_enquiry_id is not null and p_enquiry_id <> v_booking.enquiry_id then
      raise exception 'appointment not found' using errcode = 'P0002';
    end if;
    select t.mode into v_mode from public.appointment_types t where t.id = v_booking.appointment_type_id;
    if v_booking.state <> 'confirmed' then
      raise exception 'appointment not confirmed' using errcode = '22023';
    end if;
    if v_mode = 'on_site' then
      v_after := 'visit';
    elsif v_mode = 'phone' and v_booking.attendance = 'attended' then
      v_after := 'call';
    else
      raise exception 'call not held' using errcode = '22023';
    end if;
    v_enquiry_id := v_booking.enquiry_id;
  else
    if p_enquiry_id is null then
      raise exception 'appointment not found' using errcode = 'P0002';
    end if;
    select id into v_enquiry_id from public.enquiries where id = p_enquiry_id and call_held_at is not null;
    if not found then
      raise exception 'call not held' using errcode = '22023';
    end if;
    v_after := 'call';
  end if;

  select nullif(btrim(e.answers ->> 'email'), '') into v_email
  from public.enquiries e where e.id = v_enquiry_id for update;
  if v_email is null then
    raise exception 'no email address' using errcode = '22023';
  end if;

  select display_name into v_name from public.staff where user_id = (select auth.uid());
  select r.low, r.high into v_low, v_high from private.estimate_range(p_price, p_percent) r;
  if v_after = 'call' then
    v_caveats := coalesce(
      nullif(btrim((select body from public.message_blocks where key = 'estimate_call_caveats')), ''),
      private.estimate_call_caveats_default());
  else
    v_caveats := coalesce(
      nullif(btrim((select body from public.message_blocks where key = 'estimate_caveats')), ''),
      private.estimate_caveats_default());
  end if;

  insert into public.estimates (enquiry_id, booking_id, price_eur, plus_minus_percent, low_eur,
    high_eur, work_items, work_looked_at, caveats, sent_at, valid_until, created_by, created_by_name, after)
  values (v_enquiry_id, v_booking.id, p_price, p_percent, v_low, v_high, v_items, v_note,
    v_caveats, v_at, v_at + interval '10 days', (select auth.uid()), v_name, v_after)
  returning id into v_id;

  insert into public.enquiry_events (enquiry_id, kind, booking_id, detail, actor_user_id, actor_name)
  values (v_enquiry_id, 'estimate_sent', v_booking.id,
    format('€%s to €%s (price €%s, plus or minus %s%%)%s',
      to_char(v_low, 'FM999,999,999'), to_char(v_high, 'FM999,999,999'),
      to_char(p_price, 'FM999,999,999'), trim_scale(p_percent),
      case when v_after = 'call' then ', after the call' else '' end),
    (select auth.uid()), v_name);

  insert into public.communications (enquiry_id, booking_id, estimate_id, template, recipient, dedupe_key)
  values (v_enquiry_id, v_booking.id, v_id, 'estimate', v_email, 'estimate:' || v_id);

  update public.enquiries set updated_at = now() where id = v_enquiry_id;
  return v_id;
end;
$$;

revoke all on function public.send_estimate(uuid, integer, numeric, text, text[], uuid) from public, anon, authenticated;
grant execute on function public.send_estimate(uuid, integer, numeric, text, text[], uuid) to authenticated;
revoke all on function public.record_call_held_early(uuid), public.send_visit_link(uuid) from public, anon, authenticated;
grant execute on function public.record_call_held_early(uuid), public.send_visit_link(uuid) to authenticated;
revoke all on function private.visit_booked_by_staff(uuid, uuid, boolean), private.estimate_call_caveats_default()
  from public, anon, authenticated;
