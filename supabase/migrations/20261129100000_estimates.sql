-- Estimates after a site visit.
--
-- Staff enter one price (whole euro, VAT included) and a plus-or-minus percent on a site visit;
-- the range is computed (private.estimate_range, mirrored by estimateRange in
-- supabase/functions/_shared/estimate.ts) and the customer gets an estimate email with a
-- "Get my quote" button. The yes is recorded through the public-booking function with the
-- enquiry's access token (no anon SQL function). More than one estimate per enquiry is allowed
-- (an updated one after a second look); the newest is the current one.

create table public.estimates (
  id uuid primary key default gen_random_uuid(),
  enquiry_id uuid not null references public.enquiries (id) on delete cascade,
  booking_id uuid references public.bookings (id) on delete set null,
  price_eur integer not null check (price_eur between 100 and 10000000),
  plus_minus_percent numeric(3, 1) not null
    check (plus_minus_percent between 0 and 30 and (plus_minus_percent * 2) = trunc(plus_minus_percent * 2)),
  low_eur integer not null check (low_eur >= 0),
  high_eur integer not null,
  work_looked_at text not null check (char_length(work_looked_at) between 3 and 600),
  -- The caveats paragraph exactly as sent (Settings > Wording can change it later).
  caveats text not null check (char_length(caveats) between 1 and 600),
  sent_at timestamptz not null default now(),
  valid_until timestamptz not null,
  created_by uuid references public.staff (user_id) on delete set null,
  created_by_name text,
  quote_requested_at timestamptz,
  check (high_eur >= low_eur),
  check (valid_until = sent_at + interval '10 days')
);

create index estimates_by_enquiry on public.estimates (enquiry_id, sent_at desc);

comment on table public.estimates is
  'Estimates sent after a site visit: a price range, VAT included, good for 10 days. Staff only.';

revoke all on table public.estimates from public, anon, authenticated;
grant select on table public.estimates to authenticated;
grant select, insert, update, delete on table public.estimates to service_role;
alter table public.estimates enable row level security;
create policy "staff read estimates" on public.estimates
  for select to authenticated using ((select public.is_staff()));
-- No write policies: estimates are written only by public.send_estimate and the
-- public-booking function (as postgres, through private.request_quote).

-- ---------------------------------------------------------------------------------------------
-- The range rule (one place in SQL; estimateRange in TypeScript is the same rule, tests pin both)
-- ---------------------------------------------------------------------------------------------

-- low = price x (1 - p), high = price x (1 + p), rounded to the nearest 50 euro from a price of
-- 1,000, otherwise to the nearest 5 euro. 100 at 5% is 95 to 105.
create function private.estimate_range(p_price integer, p_percent numeric, out low integer, out high integer)
language sql
immutable
set search_path = ''
as $$
  select
    (round(p_price::numeric * (100 - p_percent) / 100 / u) * u)::integer,
    (round(p_price::numeric * (100 + p_percent) / 100 / u) * u)::integer
  from (select case when p_price >= 1000 then 50 else 5 end as u) step;
$$;

-- The caveats paragraph's default; the same text as WORDING.estimate_caveats in
-- supabase/functions/_shared/messages.ts (a unit test compares them).
create function private.estimate_caveats_default()
returns text
language sql
immutable
set search_path = ''
as $$
  select 'This is an estimate, not a quote. It’s a price range for the work we looked at together, with VAT included. It could change if the scope changes or if we find something we couldn’t see on the visit, which is common in older homes. It’s good for 10 days. If you want to go ahead, tell us and we’ll send your quote: one price, with what’s included and what isn’t.'::text;
$$;

-- ---------------------------------------------------------------------------------------------
-- Emails: the estimate to the customer, the quote request to staff
-- ---------------------------------------------------------------------------------------------

alter table public.communications
  add column estimate_id uuid references public.estimates (id) on delete cascade,
  drop constraint communications_template_check,
  add constraint communications_template_check check (template in (
    'booking_confirmation', 'booking_reminder', 'booking_cancelled', 'booking_rescheduled',
    'staff_new_enquiry', 'staff_callback_request', 'staff_invite', 'staff_password_reset',
    'estimate', 'staff_quote_request')),
  add constraint communications_estimate_check check (
    (template in ('estimate', 'staff_quote_request')) = (estimate_id is not null));

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
    'estimate_sent', 'quote_requested'
  ));

-- ---------------------------------------------------------------------------------------------
-- Staff: send an estimate on a site visit
-- ---------------------------------------------------------------------------------------------

create function public.send_estimate(
  p_booking_id uuid,
  p_price integer,
  p_percent numeric,
  p_work text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_booking public.bookings;
  v_mode text;
  v_email text;
  v_name text;
  v_work text := nullif(btrim(coalesce(p_work, ''), E' \t\r\n'), '');
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
  if v_work is null or char_length(v_work) not between 3 and 600 then
    raise exception 'work looked at' using errcode = '22023';
  end if;

  select b.* into v_booking from public.bookings b where b.id = p_booking_id for update;
  if not found then
    raise exception 'appointment not found' using errcode = 'P0002';
  end if;
  select t.mode into v_mode from public.appointment_types t where t.id = v_booking.appointment_type_id;
  -- A call never produces an estimate: it needs a site visit that took place or is booked.
  if v_mode is distinct from 'on_site' then
    raise exception 'site visits only' using errcode = '22023';
  end if;
  if v_booking.state <> 'confirmed' then
    raise exception 'appointment not confirmed' using errcode = '22023';
  end if;

  select nullif(btrim(e.answers ->> 'email'), '') into v_email
  from public.enquiries e where e.id = v_booking.enquiry_id for update;
  if v_email is null then
    raise exception 'no email address' using errcode = '22023';
  end if;

  select display_name into v_name from public.staff where user_id = (select auth.uid());
  select r.low, r.high into v_low, v_high from private.estimate_range(p_price, p_percent) r;
  v_caveats := coalesce(
    nullif(btrim((select body from public.message_blocks where key = 'estimate_caveats')), ''),
    private.estimate_caveats_default());

  insert into public.estimates (enquiry_id, booking_id, price_eur, plus_minus_percent, low_eur,
    high_eur, work_looked_at, caveats, sent_at, valid_until, created_by, created_by_name)
  values (v_booking.enquiry_id, v_booking.id, p_price, p_percent, v_low, v_high, v_work, v_caveats,
    v_at, v_at + interval '10 days', (select auth.uid()), v_name)
  returning id into v_id;

  insert into public.enquiry_events (enquiry_id, kind, booking_id, detail, actor_user_id, actor_name)
  values (v_booking.enquiry_id, 'estimate_sent', v_booking.id,
    format('€%s to €%s (price €%s, plus or minus %s%%)',
      to_char(v_low, 'FM999,999,999'), to_char(v_high, 'FM999,999,999'),
      to_char(p_price, 'FM999,999,999'), trim_scale(p_percent)),
    (select auth.uid()), v_name);

  insert into public.communications (enquiry_id, booking_id, estimate_id, template, recipient, dedupe_key)
  values (v_booking.enquiry_id, v_booking.id, v_id, 'estimate', v_email, 'estimate:' || v_id);

  update public.enquiries set updated_at = now() where id = v_booking.enquiry_id;
  return v_id;
end;
$$;

revoke all on function public.send_estimate(uuid, integer, numeric, text) from public, anon, authenticated;
grant execute on function public.send_estimate(uuid, integer, numeric, text) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Customer: "Get my quote" (called by public-booking as postgres, after the token check)
-- ---------------------------------------------------------------------------------------------

-- Records the yes once; repeats change nothing. Alerts every active staff member once per estimate.
create function private.request_quote(p_enquiry_id uuid, p_estimate_id uuid)
returns text
language plpgsql
set search_path = ''
as $$
declare
  v public.estimates;
begin
  select * into v from public.estimates
  where id = p_estimate_id and enquiry_id = p_enquiry_id for update;
  if not found then
    return 'not_found';
  end if;
  if v.quote_requested_at is not null then
    return 'already';
  end if;
  update public.estimates set quote_requested_at = now() where id = v.id;
  insert into public.enquiry_events (enquiry_id, kind, booking_id, detail)
  values (v.enquiry_id, 'quote_requested', v.booking_id,
    format('Estimate of %s: €%s to €%s', to_char(v.sent_at at time zone 'Europe/Dublin', 'FMDD Mon'),
      to_char(v.low_eur, 'FM999,999,999'), to_char(v.high_eur, 'FM999,999,999')));
  insert into public.communications (enquiry_id, estimate_id, template, recipient, dedupe_key)
  select v.enquiry_id, v.id, 'staff_quote_request', s.email,
    'staff_quote_request:' || v.id || ':' || s.user_id
  from public.staff s
  where s.active and s.email is not null
  on conflict (dedupe_key) do nothing;
  update public.enquiries set updated_at = now() where id = v.enquiry_id;
  return 'requested';
end;
$$;

revoke all on function private.estimate_range(integer, numeric), private.estimate_caveats_default(),
  private.request_quote(uuid, uuid) from public, anon, authenticated;
