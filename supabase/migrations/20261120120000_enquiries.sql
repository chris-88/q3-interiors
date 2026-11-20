-- Slice 1: enquiries, form versions, attribution, staff and event history.
--
-- Access model:
--   anon           no table privileges at all; may only execute submit_enquiry().
--   authenticated  SELECT on every table, filtered by RLS to staff (public.staff is the
--                  allowlist); status changes only through set_enquiry_status().
-- Later slices add bookings, appointments and commercial outcomes as their own tables keyed by
-- enquiries.id. Enquiry status stays about handling the enquiry, not about a booking or a sale.

-- ---------------------------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------------------------

create type public.enquiry_status as enum ('new', 'in_review', 'contacted', 'unsuitable');

-- ---------------------------------------------------------------------------------------------
-- Form versions: each published schema is an immutable row.
-- ---------------------------------------------------------------------------------------------

create table public.form_versions (
  form_id text not null check (form_id ~ '^[a-z][a-z0-9_]*$'),
  version integer not null check (version > 0),
  schema jsonb not null check (jsonb_typeof(schema) = 'object'),
  published_at timestamptz not null default now(),
  primary key (form_id, version)
);

comment on table public.form_versions is
  'Immutable published form schemas. Answers are always read through the version they were given in.';

create function public.form_versions_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'form version %/% is published and immutable; publish a new version instead',
    old.form_id, old.version
    using errcode = '55000';
end;
$$;

create trigger form_versions_immutable
  before update or delete on public.form_versions
  for each row execute function public.form_versions_immutable();

-- Called by supabase/forms/published.sql (generated from the repo). Inserts a new version, is a
-- no-op for an identical one, and fails loudly if a published version's schema has drifted.
create function public.publish_form_version(p_form_id text, p_version integer, p_schema jsonb)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_existing jsonb;
begin
  if p_schema ->> 'formId' is distinct from p_form_id
     or (p_schema ->> 'version')::integer is distinct from p_version then
    raise exception 'schema formId/version do not match %/%', p_form_id, p_version;
  end if;

  select schema into v_existing
  from public.form_versions
  where form_id = p_form_id and version = p_version;

  if not found then
    insert into public.form_versions (form_id, version, schema)
    values (p_form_id, p_version, p_schema);
  elsif v_existing <> p_schema then
    raise exception 'form version %/% is already published with a different schema; publish a new version instead',
      p_form_id, p_version
      using errcode = '55000';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Staff allowlist
-- ---------------------------------------------------------------------------------------------

create table public.staff (
  user_id uuid primary key references auth.users (id) on delete cascade,
  role text not null check (role in ('admin', 'staff')),
  display_name text not null check (char_length(display_name) between 1 and 120),
  created_at timestamptz not null default now()
);

comment on table public.staff is
  'Who may use the staff workspace. Rows are inserted by an operator with psql, never by the app.';

create function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.staff where user_id = (select auth.uid()));
$$;

-- ---------------------------------------------------------------------------------------------
-- Enquiries
-- ---------------------------------------------------------------------------------------------

create table public.enquiries (
  -- Stable identifier, reused by bookings, outcomes and the future estimating app.
  id uuid primary key default gen_random_uuid(),
  -- Short code shown to the customer and used on the phone, e.g. Q3-7K4M2P.
  reference text not null unique check (reference ~ '^Q3-[A-Z0-9]{6}$'),
  idempotency_key uuid not null unique,
  status public.enquiry_status not null default 'new',
  -- Required when status is 'unsuitable'; the history of every change is in enquiry_events.
  status_reason text,
  -- Current answers, keyed by field ID, interpreted through (form_id, form_version).
  form_id text not null,
  form_version integer not null,
  answers jsonb not null check (jsonb_typeof(answers) = 'object'),
  -- Promotional contact preference, recorded separately from the answers.
  marketing_opt_in boolean not null default false,
  marketing_opt_in_at timestamptz,
  submitted_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (form_id, form_version) references public.form_versions (form_id, version),
  check (status <> 'unsuitable' or nullif(btrim(status_reason), '') is not null),
  check (marketing_opt_in = (marketing_opt_in_at is not null))
);

create index enquiries_submitted_at_idx on public.enquiries (submitted_at desc);

-- Every version of the answers, starting with the submission (revision 1). Customer edits and
-- staff corrections in later slices append here and update enquiries.answers.
create table public.enquiry_revisions (
  id bigint generated always as identity primary key,
  enquiry_id uuid not null references public.enquiries (id) on delete cascade,
  revision integer not null check (revision > 0),
  form_id text not null,
  form_version integer not null,
  answers jsonb not null check (jsonb_typeof(answers) = 'object'),
  author text not null check (author in ('customer', 'staff')),
  author_user_id uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (enquiry_id, revision),
  foreign key (form_id, form_version) references public.form_versions (form_id, version)
);

-- Campaign attribution as it arrived. NULL means unknown; nothing is inferred.
create table public.enquiry_attribution (
  enquiry_id uuid primary key references public.enquiries (id) on delete cascade,
  -- 'tagged' when any utm value or a click id arrived, otherwise 'unknown'.
  tracking text not null check (tracking in ('tagged', 'unknown')),
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  utm_term text,
  -- Whether a click id (fbclid, gclid, ...) was present; NULL when nothing was captured.
  click_id_present boolean,
  -- Route the visitor first landed on, without its query string.
  landing_path text,
  first_seen_at timestamptz,
  created_at timestamptz not null default now()
);

-- Operational history: submission and every status change.
create table public.enquiry_events (
  id bigint generated always as identity primary key,
  enquiry_id uuid not null references public.enquiries (id) on delete cascade,
  kind text not null check (kind in ('submitted', 'status_changed')),
  from_status public.enquiry_status,
  to_status public.enquiry_status,
  reason text,
  actor_user_id uuid references auth.users (id) on delete set null,
  -- Snapshot of the staff member's name at the time, so history survives staff changes.
  actor_name text,
  created_at timestamptz not null default now()
);

create index enquiry_events_enquiry_idx on public.enquiry_events (enquiry_id, created_at);

-- ---------------------------------------------------------------------------------------------
-- Public submission
-- ---------------------------------------------------------------------------------------------

-- Validates the answers against the stored form version, stores the enquiry, its first revision,
-- its attribution and a 'submitted' event, and returns only the reference. A repeated
-- idempotency key returns the original reference and writes nothing.
create function public.submit_enquiry(
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
  v_field jsonb;
  v_type text;
  v_value jsonb;
  v_control jsonb;
  v_visible boolean;
  v_text text;
  v_clean jsonb := '{}'::jsonb;
  v_known text[] := '{}';
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

  -- A retry or double tap: hand back the enquiry that already exists.
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

  if p_answers is null or jsonb_typeof(p_answers) <> 'object' then
    raise exception 'answers must be an object' using errcode = '22023';
  end if;
  if octet_length(p_answers::text) > 20000 then
    raise exception 'answers are too large' using errcode = '22023';
  end if;

  -- Validate each field of the stored schema, in form order.
  for v_field in
    select f
    from jsonb_array_elements(v_schema -> 'steps') as s,
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
    -- Answers to questions the customer could not see are dropped, never stored.
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
           select 1 from jsonb_array_elements(v_field -> 'options') as o
           where o -> 'value' = v_value
         ) then
        raise exception 'invalid choice for %', v_field ->> 'id' using errcode = '22023';
      end if;
    elsif v_type = 'multi' then
      if jsonb_typeof(v_value) <> 'array'
         or exists (
           select 1 from jsonb_array_elements(v_value) as e
           where jsonb_typeof(e) <> 'string'
              or not exists (
                select 1 from jsonb_array_elements(v_field -> 'options') as o
                where o -> 'value' = e
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

  -- Attribution: optional; anything missing stays NULL (unknown).
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

  -- Insert, retrying on a reference collision. A concurrent request with the same idempotency
  -- key waits on the unique index, then finds the committed row here.
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
-- Staff status changes
-- ---------------------------------------------------------------------------------------------

create function public.set_enquiry_status(
  p_enquiry_id uuid,
  p_status public.enquiry_status,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
  v_from public.enquiry_status;
  v_reason text := nullif(btrim(p_reason, E' \t\r\n'), '');
begin
  select display_name into v_name from public.staff where user_id = (select auth.uid());
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
$$;

-- ---------------------------------------------------------------------------------------------
-- Privileges. Supabase's default privileges grant everything in public to anon and
-- authenticated, and functions are executable by PUBLIC, so take it all back explicitly.
-- ---------------------------------------------------------------------------------------------

revoke all on table
  public.form_versions, public.staff, public.enquiries, public.enquiry_revisions,
  public.enquiry_attribution, public.enquiry_events
from public, anon, authenticated;

revoke all on sequence
  public.enquiry_revisions_id_seq, public.enquiry_events_id_seq
from public, anon, authenticated;

grant select on table
  public.form_versions, public.staff, public.enquiries, public.enquiry_revisions,
  public.enquiry_attribution, public.enquiry_events
to authenticated;

revoke all on function public.form_versions_immutable() from public, anon, authenticated;
revoke all on function public.publish_form_version(text, integer, jsonb) from public, anon, authenticated;
revoke all on function public.is_staff() from public, anon, authenticated;
revoke all on function public.submit_enquiry(uuid, text, integer, jsonb, boolean, jsonb) from public, anon, authenticated;
revoke all on function public.set_enquiry_status(uuid, public.enquiry_status, text) from public, anon, authenticated;

grant execute on function public.is_staff() to authenticated;
grant execute on function public.submit_enquiry(uuid, text, integer, jsonb, boolean, jsonb) to anon, authenticated;
grant execute on function public.set_enquiry_status(uuid, public.enquiry_status, text) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Row level security: staff read everything; a signed-in non-staff user sees nothing but the
-- absence of their own staff row. No write policies: writes go through the functions above.
-- ---------------------------------------------------------------------------------------------

alter table public.form_versions enable row level security;
alter table public.staff enable row level security;
alter table public.enquiries enable row level security;
alter table public.enquiry_revisions enable row level security;
alter table public.enquiry_attribution enable row level security;
alter table public.enquiry_events enable row level security;

create policy "staff read form versions" on public.form_versions
  for select to authenticated using ((select public.is_staff()));

create policy "staff read staff; users read their own row" on public.staff
  for select to authenticated using (user_id = (select auth.uid()) or (select public.is_staff()));

create policy "staff read enquiries" on public.enquiries
  for select to authenticated using ((select public.is_staff()));

create policy "staff read revisions" on public.enquiry_revisions
  for select to authenticated using ((select public.is_staff()));

create policy "staff read attribution" on public.enquiry_attribution
  for select to authenticated using ((select public.is_staff()));

create policy "staff read events" on public.enquiry_events
  for select to authenticated using ((select public.is_staff()));
