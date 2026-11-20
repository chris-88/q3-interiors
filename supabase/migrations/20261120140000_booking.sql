-- Slice 2: booking against one Google Calendar.
--
-- Access model (unchanged for anon): anon has no table privileges. Customers reach booking only
-- through the `public-booking` Edge Function, which proves possession of an enquiry access token
-- and talks to Postgres as service_role through the functions below. Staff read through RLS.
-- Secrets (Google refresh tokens, OAuth state, access token hashes) live in the `private`
-- schema, which PostgREST does not expose and no API role can read.

create extension if not exists btree_gist with schema extensions;
create extension if not exists pg_cron;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to service_role;

-- ---------------------------------------------------------------------------------------------
-- Shared answer validation (extracted from submit_enquiry; behaviour unchanged)
-- ---------------------------------------------------------------------------------------------

create function private.clean_answers(p_schema jsonb, p_answers jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  c_ws constant text := E' \t\r\n';
  v_field jsonb;
  v_type text;
  v_value jsonb;
  v_control jsonb;
  v_visible boolean;
  v_text text;
  v_clean jsonb := '{}'::jsonb;
  v_known text[] := '{}';
begin
  if p_answers is null or jsonb_typeof(p_answers) <> 'object' then
    raise exception 'answers must be an object' using errcode = '22023';
  end if;
  if octet_length(p_answers::text) > 20000 then
    raise exception 'answers are too large' using errcode = '22023';
  end if;

  for v_field in
    select f
    from jsonb_array_elements(p_schema -> 'steps') as s,
         jsonb_array_elements(s -> 'fields') as f
  loop
    v_known := v_known || (v_field ->> 'id');
    v_type := v_field ->> 'type';

    if v_field ? 'visibleWhen' then
      v_control := p_answers -> (v_field -> 'visibleWhen' ->> 'field');
      v_visible := v_control is not null
        and jsonb_typeof(v_control) = 'string'
        and (v_field -> 'visibleWhen' -> 'in') ? (v_control #>> '{}');
    else
      v_visible := true;
    end if;
    continue when not v_visible;

    v_value := p_answers -> (v_field ->> 'id');
    if v_value is null
       or jsonb_typeof(v_value) = 'null'
       or (jsonb_typeof(v_value) = 'string' and btrim(v_value #>> '{}', c_ws) = '')
       or (jsonb_typeof(v_value) = 'array' and jsonb_array_length(v_value) = 0) then
      if (v_field ->> 'required')::boolean then
        raise exception 'missing required answer: %', v_field ->> 'id' using errcode = '22023';
      end if;
      continue;
    end if;

    if v_type = 'single' then
      if jsonb_typeof(v_value) <> 'string'
         or not exists (
           select 1 from jsonb_array_elements(v_field -> 'options') as o where o -> 'value' = v_value
         ) then
        raise exception 'invalid choice for %', v_field ->> 'id' using errcode = '22023';
      end if;
    elsif v_type = 'multi' then
      if jsonb_typeof(v_value) <> 'array'
         or exists (
           select 1 from jsonb_array_elements(v_value) as e
           where jsonb_typeof(e) <> 'string'
              or not exists (
                select 1 from jsonb_array_elements(v_field -> 'options') as o where o -> 'value' = e
              )
         )
         or (select count(distinct e) from jsonb_array_elements(v_value) as e)
            <> jsonb_array_length(v_value) then
        raise exception 'invalid choices for %', v_field ->> 'id' using errcode = '22023';
      end if;
    else
      if jsonb_typeof(v_value) <> 'string' then
        raise exception 'invalid text for %', v_field ->> 'id' using errcode = '22023';
      end if;
      v_text := btrim(v_value #>> '{}', c_ws);
      if char_length(v_text) > (v_field ->> 'maxLength')::integer
         or (v_field ? 'minLength' and char_length(v_text) < (v_field ->> 'minLength')::integer) then
        raise exception 'invalid length for %', v_field ->> 'id' using errcode = '22023';
      end if;
      -- Keep these in step with EMAIL_PATTERN and PHONE_PATTERN in src/forms/logic.ts.
      if v_type = 'email' and v_text !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then
        raise exception 'invalid email' using errcode = '22023';
      end if;
      if v_type = 'tel' and (
           v_text !~ '^\+?[0-9 ()-]{7,30}$'
           or char_length(regexp_replace(v_text, '\D', '', 'g')) < 7
         ) then
        raise exception 'invalid phone' using errcode = '22023';
      end if;
      v_value := to_jsonb(v_text);
    end if;

    v_clean := v_clean || jsonb_build_object(v_field ->> 'id', v_value);
  end loop;

  if exists (select 1 from jsonb_object_keys(p_answers) as k where k <> all (v_known)) then
    raise exception 'unknown answer key' using errcode = '22023';
  end if;
  return v_clean;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Enquiry access tokens: scoped to one enquiry, expiring, only the hash is stored.
-- ---------------------------------------------------------------------------------------------

create table private.enquiry_access_tokens (
  token_hash text primary key,
  enquiry_id uuid not null references public.enquiries (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index enquiry_access_tokens_enquiry_idx on private.enquiry_access_tokens (enquiry_id);

create function private.hash_token(p_token text)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
$$;

-- Mints a new token for an enquiry. 32 random bytes, base64url, never stored in clear.
create function private.mint_enquiry_token(p_enquiry_id uuid, p_ttl interval default interval '30 days')
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_token text := rtrim(translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/', '-_'), '=');
  v_expires timestamptz := now() + p_ttl;
begin
  insert into private.enquiry_access_tokens (token_hash, enquiry_id, expires_at)
  values (private.hash_token(v_token), p_enquiry_id, v_expires);
  return jsonb_build_object('access_token', v_token, 'expires_at', v_expires);
end;
$$;

-- The enquiry a token grants access to, or NULL if it is unknown or expired.
create function public.resolve_enquiry_token(p_token text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select enquiry_id
  from private.enquiry_access_tokens
  where token_hash = private.hash_token(coalesce(p_token, ''))
    and expires_at > now();
$$;

-- Slice 2 submission: same validation and idempotency as submit_enquiry (which it calls and which
-- stays in place for older clients), plus an access token for scheduling. A retry with the same
-- idempotency key returns the same reference and a fresh token for the same enquiry.
create function public.submit_enquiry_with_access(
  p_idempotency_key uuid,
  p_form_id text,
  p_form_version integer,
  p_answers jsonb,
  p_marketing_opt_in boolean default false,
  p_attribution jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reference text;
  v_id uuid;
begin
  v_reference := public.submit_enquiry(
    p_idempotency_key, p_form_id, p_form_version, p_answers, p_marketing_opt_in, p_attribution);
  select id into v_id from public.enquiries where idempotency_key = p_idempotency_key;
  return jsonb_build_object('reference', v_reference) || private.mint_enquiry_token(v_id);
end;
$$;

-- submit_enquiry now delegates answer validation to private.clean_answers.
create or replace function public.submit_enquiry(
  p_idempotency_key uuid,
  p_form_id text,
  p_form_version integer,
  p_answers jsonb,
  p_marketing_opt_in boolean default false,
  p_attribution jsonb default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_ws constant text := E' \t\r\n';
  c_alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v_schema jsonb;
  v_reference text;
  v_text text;
  v_clean jsonb;
  v_id uuid;
  v_attempt integer := 0;
  v_attr jsonb := coalesce(p_attribution, 'null'::jsonb);
  v_utm jsonb := '{}'::jsonb;
  v_key text;
  v_click boolean;
  v_landing text;
  v_first_seen timestamptz;
  v_tagged boolean;
begin
  if p_idempotency_key is null then
    raise exception 'idempotency key is required' using errcode = '22023';
  end if;

  select reference into v_reference from public.enquiries where idempotency_key = p_idempotency_key;
  if found then
    return v_reference;
  end if;

  select schema into v_schema
  from public.form_versions
  where form_id = p_form_id and version = p_form_version;
  if not found then
    raise exception 'unknown form version' using errcode = '22023';
  end if;

  v_clean := private.clean_answers(v_schema, p_answers);

  if jsonb_typeof(v_attr) not in ('object', 'null') then
    raise exception 'attribution must be an object' using errcode = '22023';
  end if;
  if jsonb_typeof(v_attr) = 'object' then
    if exists (
      select 1 from jsonb_object_keys(v_attr) as k
      where k not in ('utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term',
                      'click_id_present', 'landing_path', 'first_seen_at')
    ) then
      raise exception 'unknown attribution key' using errcode = '22023';
    end if;
    foreach v_key in array array['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'] loop
      if v_attr ? v_key and jsonb_typeof(v_attr -> v_key) = 'string' then
        v_text := left(btrim(v_attr ->> v_key, c_ws), 200);
        if v_text <> '' then
          v_utm := v_utm || jsonb_build_object(v_key, v_text);
        end if;
      end if;
    end loop;
    if jsonb_typeof(v_attr -> 'click_id_present') = 'boolean' then
      v_click := (v_attr ->> 'click_id_present')::boolean;
    end if;
    if jsonb_typeof(v_attr -> 'landing_path') = 'string'
       and (v_attr ->> 'landing_path') ~ '^/[A-Za-z0-9/_-]{0,199}$' then
      v_landing := v_attr ->> 'landing_path';
    end if;
    if jsonb_typeof(v_attr -> 'first_seen_at') = 'string' then
      begin
        v_first_seen := (v_attr ->> 'first_seen_at')::timestamptz;
        if v_first_seen > now() + interval '1 day' then
          v_first_seen := null;
        end if;
      exception when others then
        v_first_seen := null;
      end;
    end if;
  end if;
  v_tagged := v_utm <> '{}'::jsonb or coalesce(v_click, false);

  loop
    v_reference := 'Q3-' || (
      select string_agg(substr(c_alphabet, 1 + floor(random() * length(c_alphabet))::integer, 1), '')
      from generate_series(1, 6)
    );
    begin
      insert into public.enquiries (
        reference, idempotency_key, form_id, form_version, answers,
        marketing_opt_in, marketing_opt_in_at
      ) values (
        v_reference, p_idempotency_key, p_form_id, p_form_version, v_clean,
        coalesce(p_marketing_opt_in, false),
        case when coalesce(p_marketing_opt_in, false) then now() end
      )
      returning id into v_id;
      exit;
    exception when unique_violation then
      select reference into v_reference from public.enquiries where idempotency_key = p_idempotency_key;
      if found then
        return v_reference;
      end if;
      v_attempt := v_attempt + 1;
      if v_attempt >= 5 then
        raise;
      end if;
    end;
  end loop;

  insert into public.enquiry_revisions (enquiry_id, revision, form_id, form_version, answers, author)
  values (v_id, 1, p_form_id, p_form_version, v_clean, 'customer');

  insert into public.enquiry_attribution (
    enquiry_id, tracking, utm_source, utm_medium, utm_campaign, utm_content, utm_term,
    click_id_present, landing_path, first_seen_at
  ) values (
    v_id,
    case when v_tagged then 'tagged' else 'unknown' end,
    v_utm ->> 'utm_source', v_utm ->> 'utm_medium', v_utm ->> 'utm_campaign',
    v_utm ->> 'utm_content', v_utm ->> 'utm_term',
    v_click, v_landing, v_first_seen
  );

  insert into public.enquiry_events (enquiry_id, kind, to_status)
  values (v_id, 'submitted', 'new');

  return v_reference;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Enquiry additions: site details (from a separate published form) and contact requests
-- ---------------------------------------------------------------------------------------------

alter table public.enquiries
  add column site_details jsonb check (site_details is null or jsonb_typeof(site_details) = 'object'),
  add column site_details_form_version integer,
  add column contact_requested_at timestamptz,
  add column contact_request_reason text;

alter table public.enquiry_events drop constraint enquiry_events_kind_check;
alter table public.enquiry_events
  add column booking_id uuid,
  add column detail text,
  add constraint enquiry_events_kind_check check (kind in (
    'submitted', 'status_changed', 'site_details_added', 'contact_requested',
    'booking_requested', 'booking_confirmed', 'booking_failed', 'booking_retrying',
    'email_sent', 'email_failed'
  ));

-- Stores site details as a new revision and as the enquiry's current site details.
create function private.save_site_details(p_enquiry_id uuid, p_answers jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_schema jsonb;
  v_version integer;
  v_clean jsonb;
begin
  select schema, version into v_schema, v_version
  from public.form_versions
  where form_id = 'site_details'
  order by version desc
  limit 1;
  if not found then
    raise exception 'site details form is not published' using errcode = '55000';
  end if;
  v_clean := private.clean_answers(v_schema, p_answers);

  perform 1 from public.enquiries where id = p_enquiry_id for update;
  if not found then
    raise exception 'enquiry not found' using errcode = 'P0002';
  end if;

  insert into public.enquiry_revisions (enquiry_id, revision, form_id, form_version, answers, author)
  select p_enquiry_id, coalesce(max(revision), 0) + 1, 'site_details', v_version, v_clean, 'customer'
  from public.enquiry_revisions where enquiry_id = p_enquiry_id;

  update public.enquiries
  set site_details = v_clean, site_details_form_version = v_version, updated_at = now()
  where id = p_enquiry_id;

  insert into public.enquiry_events (enquiry_id, kind) values (p_enquiry_id, 'site_details_added');
  return v_clean;
end;
$$;

create function private.request_contact(p_enquiry_id uuid, p_reason text)
returns void
language plpgsql
set search_path = ''
as $$
begin
  update public.enquiries
  set contact_requested_at = coalesce(contact_requested_at, now()),
      contact_request_reason = left(p_reason, 200),
      updated_at = now()
  where id = p_enquiry_id;
  if not found then
    raise exception 'enquiry not found' using errcode = 'P0002';
  end if;
  insert into public.enquiry_events (enquiry_id, kind, detail)
  values (p_enquiry_id, 'contact_requested', left(p_reason, 200));
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Appointment types and staff availability (placeholder values, editable by staff)
-- ---------------------------------------------------------------------------------------------

create table public.appointment_types (
  id text primary key check (id ~ '^[a-z][a-z0-9_]*$'),
  label text not null,
  description text not null,
  what_to_prepare text not null,
  mode text not null check (mode in ('phone', 'on_site')),
  duration_minutes integer not null check (duration_minutes between 5 and 480),
  buffer_before_minutes integer not null default 0 check (buffer_before_minutes between 0 and 240),
  buffer_after_minutes integer not null default 0 check (buffer_after_minutes between 0 and 240),
  requires_site_address boolean not null default false,
  requires_phone boolean not null default false,
  active boolean not null default true,
  sort_order integer not null default 0,
  updated_at timestamptz not null default now()
);

comment on table public.appointment_types is
  'Bookable appointment types. Seeded values are PLACEHOLDERS to be confirmed with Q3 Interiors.';

insert into public.appointment_types
  (id, label, description, what_to_prepare, mode, duration_minutes, buffer_before_minutes,
   buffer_after_minutes, requires_site_address, requires_phone, sort_order)
values
  ('phone_consultation', 'Phone consultation',
   'A call to talk through your project and the next steps.',
   'Have a rough idea of the rooms involved and any measurements or photos you already have.',
   'phone', 20, 0, 10, false, true, 1),
  ('site_visit', 'Estimate visit at your home',
   'We visit to see the space, take measurements and give you an estimated range.',
   'Make sure we can get into the rooms involved. Have any plans or ideas you have collected to hand.',
   'on_site', 60, 30, 30, true, true, 2);

create table public.staff_availability (
  staff_user_id uuid primary key references public.staff (user_id) on delete cascade,
  -- ISO weekday ("1" = Monday .. "7" = Sunday) -> [["09:00","17:00"], ...] in Europe/Dublin.
  working_hours jsonb not null check (jsonb_typeof(working_hours) = 'object'),
  min_notice_minutes integer not null check (min_notice_minutes between 0 and 20160),
  horizon_days integer not null check (horizon_days between 1 and 120),
  daily_visit_limit integer not null check (daily_visit_limit between 0 and 20),
  slot_step_minutes integer not null default 30 check (slot_step_minutes in (10, 15, 20, 30, 60)),
  updated_at timestamptz not null default now()
);

comment on table public.staff_availability is
  'Who takes bookings and when. Seeded values are PLACEHOLDERS to be confirmed with Q3 Interiors.';

-- Every existing admin becomes bookable with placeholder hours (the pilot has one).
insert into public.staff_availability
  (staff_user_id, working_hours, min_notice_minutes, horizon_days, daily_visit_limit)
select user_id,
  '{"1":[["09:00","17:00"]],"2":[["09:00","17:00"]],"3":[["09:00","17:00"]],
    "4":[["09:00","17:00"]],"5":[["09:00","17:00"]]}'::jsonb,
  24 * 60, 21, 3
from public.staff where role = 'admin';

-- ---------------------------------------------------------------------------------------------
-- Google Calendar connection. Tokens are encrypted by the Edge Functions (AES-GCM, key only in
-- the functions container) and stored in private; the public table holds health only.
-- ---------------------------------------------------------------------------------------------

create table public.calendar_connections (
  staff_user_id uuid primary key references public.staff (user_id) on delete cascade,
  status text not null check (status in ('connected', 'disconnected')),
  google_email text,
  calendar_id text not null default 'primary',
  scopes text,
  connected_at timestamptz,
  last_success_at timestamptz,
  last_error text,
  last_error_at timestamptz,
  updated_at timestamptz not null default now()
);

create table private.calendar_tokens (
  staff_user_id uuid primary key references public.staff (user_id) on delete cascade,
  refresh_token_ciphertext text not null,
  updated_at timestamptz not null default now()
);

create table private.oauth_states (
  state_hash text primary key,
  staff_user_id uuid not null references public.staff (user_id) on delete cascade,
  code_verifier text not null,
  expires_at timestamptz not null
);

-- ---------------------------------------------------------------------------------------------
-- Bookings
-- ---------------------------------------------------------------------------------------------

-- reserved: slot held, nothing sent to Google yet. calendar_pending: event creation in progress or
-- awaiting retry. confirmed: the calendar event exists. failed: the event definitively does not
-- exist (or could not be confirmed) and the slot is released. cancelled: slice 3.
create type public.booking_state as enum ('reserved', 'calendar_pending', 'confirmed', 'failed', 'cancelled');

create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  enquiry_id uuid not null references public.enquiries (id) on delete cascade,
  staff_user_id uuid not null references public.staff (user_id),
  appointment_type_id text not null references public.appointment_types (id),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  -- The appointment plus its buffers: what may not overlap another live booking.
  blocked tstzrange not null,
  state public.booking_state not null default 'reserved',
  idempotency_key uuid not null unique,
  -- Deterministic Google event id (base32hex alphabet), fixed before the first insert attempt.
  calendar_event_id text not null unique,
  calendar_event_link text,
  failure_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  confirmed_at timestamptz,
  check (ends_at > starts_at),
  check (blocked @> tstzrange(starts_at, ends_at)),
  constraint bookings_no_overlap exclude using gist (
    staff_user_id with =,
    blocked with &&
  ) where (state in ('reserved', 'calendar_pending', 'confirmed'))
);

-- One live booking per enquiry; a failed one can be replaced.
create unique index bookings_one_live_per_enquiry on public.bookings (enquiry_id)
  where state in ('reserved', 'calendar_pending', 'confirmed');
create index bookings_starts_at_idx on public.bookings (starts_at);

alter table public.enquiry_events
  add constraint enquiry_events_booking_fk foreign key (booking_id) references public.bookings (id) on delete cascade;

-- Retry-able external operations. Claimed by the booking worker with SKIP LOCKED.
create table public.integration_jobs (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('create_calendar_event')),
  booking_id uuid not null references public.bookings (id) on delete cascade,
  state text not null default 'queued' check (state in ('queued', 'running', 'succeeded', 'failed')),
  attempts integer not null default 0,
  max_attempts integer not null default 8,
  next_attempt_at timestamptz not null default now(),
  locked_until timestamptz,
  -- True once a request may have reached Google without a known result.
  outcome_unknown boolean not null default false,
  external_id text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (kind, booking_id)
);

create index integration_jobs_due_idx on public.integration_jobs (next_attempt_at) where state in ('queued', 'running');

-- Outgoing messages. dedupe_key makes a retry never send twice; it is also sent to the email
-- provider as its idempotency key.
create table public.communications (
  id uuid primary key default gen_random_uuid(),
  enquiry_id uuid not null references public.enquiries (id) on delete cascade,
  booking_id uuid references public.bookings (id) on delete cascade,
  template text not null check (template in ('booking_confirmation')),
  recipient text not null,
  planned_at timestamptz not null default now(),
  state text not null default 'queued' check (state in ('queued', 'sending', 'sent', 'failed')),
  attempts integer not null default 0,
  max_attempts integer not null default 6,
  next_attempt_at timestamptz not null default now(),
  locked_until timestamptz,
  dedupe_key text not null unique,
  provider_message_id text,
  last_error text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index communications_due_idx on public.communications (next_attempt_at) where state in ('queued', 'sending');

-- ---------------------------------------------------------------------------------------------
-- Booking rules (server side)
-- ---------------------------------------------------------------------------------------------

-- The one place eligibility is decided. For the pilot every saved enquiry may book any active
-- type whose requirements are met. Returns 'eligible' or a reason code.
create function public.enquiry_booking_eligibility(p_enquiry_id uuid, p_type_id text)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  v_type public.appointment_types;
  v_enquiry public.enquiries;
begin
  select * into v_type from public.appointment_types where id = p_type_id and active;
  if not found then
    return 'unknown_type';
  end if;
  select * into v_enquiry from public.enquiries where id = p_enquiry_id;
  if not found then
    return 'unknown_enquiry';
  end if;
  if v_type.requires_phone and coalesce(v_enquiry.answers ->> 'phone', '') = '' then
    return 'phone_required';
  end if;
  if v_type.requires_site_address and coalesce(v_enquiry.site_details ->> 'site_address', '') = '' then
    return 'site_address_required';
  end if;
  return 'eligible';
end;
$$;

-- The staff member who takes bookings: the first with availability set (pilot: one person).
create function public.bookable_staff()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select a.staff_user_id
  from public.staff_availability a
  join public.staff s on s.user_id = a.staff_user_id
  order by s.created_at
  limit 1;
$$;

-- Reserve a slot. The caller (the public-booking function) has already checked the slot against
-- working hours, notice, horizon and Google free/busy; this enforces the rules that a race could
-- break: no overlap (exclusion constraint), the daily visit limit (serialised per staff and day),
-- one live booking per enquiry, and idempotency.
create function private.reserve_booking(
  p_enquiry_id uuid,
  p_type_id text,
  p_starts_at timestamptz,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_type public.appointment_types;
  v_staff uuid := public.bookable_staff();
  v_avail public.staff_availability;
  v_existing public.bookings;
  v_id uuid := gen_random_uuid();
  v_ends timestamptz;
  v_day date;
  v_count integer;
  v_eligibility text;
begin
  select * into v_existing from public.bookings where idempotency_key = p_idempotency_key;
  if found then
    if v_existing.enquiry_id <> p_enquiry_id then
      raise exception 'idempotency key belongs to another enquiry' using errcode = '42501';
    end if;
    return jsonb_build_object('status', 'existing', 'booking_id', v_existing.id);
  end if;

  v_eligibility := public.enquiry_booking_eligibility(p_enquiry_id, p_type_id);
  if v_eligibility <> 'eligible' then
    return jsonb_build_object('status', 'ineligible', 'reason', v_eligibility);
  end if;
  if v_staff is null then
    return jsonb_build_object('status', 'no_staff');
  end if;

  select * into v_type from public.appointment_types where id = p_type_id;
  select * into v_avail from public.staff_availability where staff_user_id = v_staff;
  v_ends := p_starts_at + make_interval(mins => v_type.duration_minutes);

  if p_starts_at < now() + make_interval(mins => v_avail.min_notice_minutes) then
    return jsonb_build_object('status', 'slot_unavailable', 'reason', 'notice');
  end if;

  if v_type.mode = 'on_site' then
    v_day := (p_starts_at at time zone 'Europe/Dublin')::date;
    perform pg_advisory_xact_lock(hashtextextended(v_staff::text || v_day::text, 0));
    select count(*) into v_count
    from public.bookings b
    join public.appointment_types t on t.id = b.appointment_type_id
    where b.staff_user_id = v_staff
      and t.mode = 'on_site'
      and b.state in ('reserved', 'calendar_pending', 'confirmed')
      and (b.starts_at at time zone 'Europe/Dublin')::date = v_day;
    if v_count >= v_avail.daily_visit_limit then
      return jsonb_build_object('status', 'slot_unavailable', 'reason', 'daily_limit');
    end if;
  end if;

  begin
    insert into public.bookings (
      id, enquiry_id, staff_user_id, appointment_type_id, starts_at, ends_at, blocked,
      idempotency_key, calendar_event_id
    ) values (
      v_id, p_enquiry_id, v_staff, p_type_id, p_starts_at, v_ends,
      tstzrange(
        p_starts_at - make_interval(mins => v_type.buffer_before_minutes),
        v_ends + make_interval(mins => v_type.buffer_after_minutes)
      ),
      p_idempotency_key,
      'q3' || replace(v_id::text, '-', '')
    );
  exception
    when exclusion_violation then
      return jsonb_build_object('status', 'slot_unavailable', 'reason', 'taken');
    when unique_violation then
      -- Either a concurrent request with this key won, or the enquiry already has a live booking.
      select * into v_existing from public.bookings where idempotency_key = p_idempotency_key;
      if found then
        return jsonb_build_object('status', 'existing', 'booking_id', v_existing.id);
      end if;
      select * into v_existing from public.bookings
      where enquiry_id = p_enquiry_id and state in ('reserved', 'calendar_pending', 'confirmed');
      return jsonb_build_object('status', 'already_booked', 'booking_id', v_existing.id);
  end;

  insert into public.integration_jobs (kind, booking_id) values ('create_calendar_event', v_id);
  insert into public.enquiry_events (enquiry_id, kind, booking_id, detail)
  values (p_enquiry_id, 'booking_requested', v_id,
          v_type.label || ' at ' || to_char(p_starts_at at time zone 'Europe/Dublin', 'Dy DD Mon YYYY HH24:MI'));
  return jsonb_build_object('status', 'reserved', 'booking_id', v_id);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Job and message state transitions (called by the functions as service_role)
-- ---------------------------------------------------------------------------------------------

create function private.claim_calendar_jobs(p_limit integer, p_booking_id uuid default null)
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
    where (p_booking_id is null or booking_id = p_booking_id)
      and ((state = 'queued' and next_attempt_at <= now())
        or (state = 'running' and locked_until < now()))
    order by next_attempt_at
    for update skip locked
    limit p_limit
  )
  returning j.*;
$$;

create function private.calendar_job_started(p_job_id bigint)
returns void
language sql
set search_path = ''
as $$
  update public.bookings b set state = 'calendar_pending', updated_at = now()
  from public.integration_jobs j
  where j.id = p_job_id and b.id = j.booking_id and b.state = 'reserved';
$$;

-- The event exists: confirm the booking and queue the confirmation email (deduplicated).
create function private.complete_calendar_job(p_job_id bigint, p_event_link text)
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

create function private.retry_calendar_job(
  p_job_id bigint, p_error text, p_outcome_unknown boolean, p_delay_seconds integer
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_job public.integration_jobs;
begin
  update public.integration_jobs
  set state = 'queued',
      locked_until = null,
      last_error = left(p_error, 500),
      outcome_unknown = outcome_unknown or p_outcome_unknown,
      next_attempt_at = now() + make_interval(secs => p_delay_seconds),
      updated_at = now()
  where id = p_job_id
  returning * into v_job;

  update public.bookings set state = 'calendar_pending', updated_at = now()
  where id = v_job.booking_id and state = 'reserved';

  insert into public.enquiry_events (enquiry_id, kind, booking_id, detail)
  select enquiry_id, 'booking_retrying', id, left(p_error, 300)
  from public.bookings where id = v_job.booking_id;
end;
$$;

-- Definitive failure: the slot is released (failed is not a live state) and staff see it.
create function private.fail_calendar_job(p_job_id bigint, p_error text, p_outcome_unknown boolean)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_job public.integration_jobs;
  v_reason text;
begin
  update public.integration_jobs
  set state = 'failed', locked_until = null, last_error = left(p_error, 500),
      outcome_unknown = outcome_unknown or p_outcome_unknown, updated_at = now()
  where id = p_job_id
  returning * into v_job;

  v_reason := case when v_job.outcome_unknown
    then 'Calendar event could not be confirmed; it may exist with id ' ||
         (select calendar_event_id from public.bookings where id = v_job.booking_id) || '. ' || left(p_error, 300)
    else left(p_error, 400) end;

  update public.bookings set state = 'failed', failure_reason = v_reason, updated_at = now()
  where id = v_job.booking_id and state in ('reserved', 'calendar_pending');

  insert into public.enquiry_events (enquiry_id, kind, booking_id, detail)
  select enquiry_id, 'booking_failed', id, v_reason from public.bookings where id = v_job.booking_id;
end;
$$;

create function private.claim_communications(p_limit integer, p_booking_id uuid default null)
returns setof public.communications
language sql
set search_path = ''
as $$
  update public.communications c
  set state = 'sending',
      attempts = c.attempts + 1,
      locked_until = now() + interval '2 minutes',
      updated_at = now()
  where c.id in (
    select id from public.communications
    where (p_booking_id is null or booking_id = p_booking_id)
      and planned_at <= now()
      and ((state = 'queued' and next_attempt_at <= now())
        or (state = 'sending' and locked_until < now()))
    order by next_attempt_at
    for update skip locked
    limit p_limit
  )
  returning c.*;
$$;

create function private.communication_sent(p_id uuid, p_provider_id text)
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
  if found then
    insert into public.enquiry_events (enquiry_id, kind, booking_id, detail)
    values (v.enquiry_id, 'email_sent', v.booking_id, v.template);
  end if;
end;
$$;

create function private.communication_retry(p_id uuid, p_error text, p_delay_seconds integer, p_final boolean)
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
  if p_final then
    insert into public.enquiry_events (enquiry_id, kind, booking_id, detail)
    values (v.enquiry_id, 'email_failed', v.booking_id, left(p_error, 300));
  end if;
end;
$$;

-- Everything a booking job or email needs, in one read.
create function private.booking_context(p_booking_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'booking', to_jsonb(b),
    'type', to_jsonb(t),
    'enquiry', jsonb_build_object(
      'id', e.id, 'reference', e.reference, 'answers', e.answers, 'site_details', e.site_details),
    'staff', jsonb_build_object('user_id', s.user_id, 'display_name', s.display_name),
    'connection', to_jsonb(c)
  )
  from public.bookings b
  join public.appointment_types t on t.id = b.appointment_type_id
  join public.enquiries e on e.id = b.enquiry_id
  join public.staff s on s.user_id = b.staff_user_id
  left join public.calendar_connections c on c.staff_user_id = b.staff_user_id
  where b.id = p_booking_id;
$$;

-- ---------------------------------------------------------------------------------------------
-- Calendar connection transitions
-- ---------------------------------------------------------------------------------------------

create function private.store_calendar_connection(
  p_staff uuid, p_email text, p_scopes text, p_ciphertext text
)
returns void
language plpgsql
set search_path = ''
as $$
begin
  insert into private.calendar_tokens (staff_user_id, refresh_token_ciphertext)
  values (p_staff, p_ciphertext)
  on conflict (staff_user_id) do update
    set refresh_token_ciphertext = excluded.refresh_token_ciphertext, updated_at = now();

  insert into public.calendar_connections
    (staff_user_id, status, google_email, scopes, connected_at, last_error, last_error_at)
  values (p_staff, 'connected', p_email, p_scopes, now(), null, null)
  on conflict (staff_user_id) do update
    set status = 'connected', google_email = excluded.google_email, scopes = excluded.scopes,
        connected_at = now(), last_error = null, last_error_at = null, updated_at = now();

  -- Bookings that were waiting on a reconnect are retried straight away.
  update public.integration_jobs j
  set next_attempt_at = now(), updated_at = now()
  from public.bookings b
  where j.booking_id = b.id and b.staff_user_id = p_staff and j.state = 'queued';
end;
$$;

create function private.mark_calendar_disconnected(p_staff uuid, p_error text)
returns void
language sql
set search_path = ''
as $$
  update public.calendar_connections
  set status = 'disconnected', last_error = left(p_error, 500), last_error_at = now(), updated_at = now()
  where staff_user_id = p_staff;
$$;

create function private.record_calendar_error(p_staff uuid, p_error text)
returns void
language sql
set search_path = ''
as $$
  update public.calendar_connections
  set last_error = left(p_error, 500), last_error_at = now(), updated_at = now()
  where staff_user_id = p_staff;
$$;

create function private.remove_calendar_connection(p_staff uuid)
returns void
language sql
set search_path = ''
as $$
  delete from private.calendar_tokens where staff_user_id = p_staff;
  update public.calendar_connections
  set status = 'disconnected', last_error = 'Disconnected by staff', last_error_at = now(), updated_at = now()
  where staff_user_id = p_staff;
$$;

-- ---------------------------------------------------------------------------------------------
-- Worker schedule: pg_cron calls the booking-worker function every minute through pg_net. The
-- worker secret and the anon key (which the functions router needs as a JWT) are read from Vault
-- (`q3_worker_secret`, `q3_functions_jwt`), inserted by scripts/worker-secrets.sh, never committed.
-- ---------------------------------------------------------------------------------------------

create function private.kick_worker()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret text;
  v_jwt text;
begin
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'q3_worker_secret';
  select decrypted_secret into v_jwt from vault.decrypted_secrets where name = 'q3_functions_jwt';
  if v_secret is null or v_jwt is null then
    raise notice 'booking worker secrets are not in vault; skipping';
    return;
  end if;
  perform net.http_post(
    url := 'http://functions:9000/booking-worker',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_jwt,
      'x-worker-secret', v_secret
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
end;
$$;

select cron.schedule('q3-booking-worker', '* * * * *', 'select private.kick_worker()');

-- ---------------------------------------------------------------------------------------------
-- Privileges and RLS
-- ---------------------------------------------------------------------------------------------

revoke all on all tables in schema private from public, anon, authenticated;
revoke all on all functions in schema private from public, anon, authenticated;
grant all on all tables in schema private to service_role;
grant execute on all functions in schema private to service_role;

revoke all on table
  public.appointment_types, public.staff_availability, public.calendar_connections,
  public.bookings, public.integration_jobs, public.communications
from public, anon, authenticated;
revoke all on sequence public.integration_jobs_id_seq from public, anon, authenticated;

grant select on table
  public.appointment_types, public.staff_availability, public.calendar_connections,
  public.bookings, public.integration_jobs, public.communications
to authenticated;

-- Staff edit settings directly (RLS below); only these columns.
grant update (label, description, what_to_prepare, duration_minutes, buffer_before_minutes,
              buffer_after_minutes, active, updated_at)
  on public.appointment_types to authenticated;
grant update (working_hours, min_notice_minutes, horizon_days, daily_visit_limit,
              slot_step_minutes, updated_at)
  on public.staff_availability to authenticated;

grant select, insert, update, delete on table
  public.appointment_types, public.staff_availability, public.calendar_connections,
  public.bookings, public.integration_jobs, public.communications
to service_role;
grant usage on sequence public.integration_jobs_id_seq to service_role;
grant select, insert, update on table
  public.enquiries, public.enquiry_revisions, public.enquiry_events, public.staff
to service_role;
grant usage on all sequences in schema public to service_role;

revoke all on function public.resolve_enquiry_token(text) from public, anon, authenticated;
revoke all on function public.submit_enquiry_with_access(uuid, text, integer, jsonb, boolean, jsonb)
  from public, anon, authenticated;
revoke all on function public.enquiry_booking_eligibility(uuid, text) from public, anon, authenticated;
revoke all on function public.bookable_staff() from public, anon, authenticated;
grant execute on function public.resolve_enquiry_token(text) to service_role;
grant execute on function public.submit_enquiry_with_access(uuid, text, integer, jsonb, boolean, jsonb)
  to anon, authenticated;
grant execute on function public.enquiry_booking_eligibility(uuid, text) to service_role, authenticated;
grant execute on function public.bookable_staff() to service_role, authenticated;
-- submit_enquiry was replaced in place; re-assert its grants.
revoke all on function public.submit_enquiry(uuid, text, integer, jsonb, boolean, jsonb) from public;
grant execute on function public.submit_enquiry(uuid, text, integer, jsonb, boolean, jsonb) to anon, authenticated;

alter table public.appointment_types enable row level security;
alter table public.staff_availability enable row level security;
alter table public.calendar_connections enable row level security;
alter table public.bookings enable row level security;
alter table public.integration_jobs enable row level security;
alter table public.communications enable row level security;
alter table private.enquiry_access_tokens enable row level security;
alter table private.calendar_tokens enable row level security;
alter table private.oauth_states enable row level security;

create policy "staff read appointment types" on public.appointment_types
  for select to authenticated using ((select public.is_staff()));
create policy "staff edit appointment types" on public.appointment_types
  for update to authenticated using ((select public.is_staff())) with check ((select public.is_staff()));
create policy "staff read availability" on public.staff_availability
  for select to authenticated using ((select public.is_staff()));
create policy "staff edit availability" on public.staff_availability
  for update to authenticated using ((select public.is_staff())) with check ((select public.is_staff()));
create policy "staff read calendar connections" on public.calendar_connections
  for select to authenticated using ((select public.is_staff()));
create policy "staff read bookings" on public.bookings
  for select to authenticated using ((select public.is_staff()));
create policy "staff read jobs" on public.integration_jobs
  for select to authenticated using ((select public.is_staff()));
create policy "staff read communications" on public.communications
  for select to authenticated using ((select public.is_staff()));
-- service_role bypasses RLS; the private tables have no policies, so nobody else reads them.
