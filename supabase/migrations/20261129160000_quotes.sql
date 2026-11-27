-- Quotes: one price for the work, in writing, sent to the customer as an email with a PDF.
--
-- Staff write a quote from an estimate (or without one): the price (VAT included), what is
-- included and what is not (tick-lists that learn, like the estimate's work items), a note, a
-- 10% deposit. send_quote numbers it (Q3-Q-0001, kept across versions of the same enquiry's
-- quote), snapshots the terms, sets the enquiry's outcome to quoted through the existing outcome
-- logic (so the report keeps working) and queues the email. The worker renders the document,
-- makes the PDF (Gotenberg, internal to the stack), stores it in the private `quotes` bucket and
-- attaches it. A newer version supersedes the older one. The customer views the quote, downloads
-- the PDF and asks for a change through the public-booking function with the enquiry token.

-- ---------------------------------------------------------------------------------------------
-- Working days (Monday to Friday; public holidays NOT modelled yet). Mirrors addWorkingDays in
-- supabase/functions/_shared/working-days.ts; the tests use the same cases.
-- ---------------------------------------------------------------------------------------------

create function private.add_working_days(p_from date, p_days integer)
returns date
language plpgsql
immutable
set search_path = ''
as $$
declare
  v date := p_from;
  v_left integer := p_days;
begin
  while v_left > 0 loop
    v := v + 1;
    if extract(isodow from v) < 6 then
      v_left := v_left - 1;
    end if;
  end loop;
  return v;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- What is not included: a second learnable tick-list on the same table
-- ---------------------------------------------------------------------------------------------

alter table public.estimate_work_items
  add column kind text not null default 'included' check (kind in ('included', 'excluded'));
comment on column public.estimate_work_items.kind is
  'included: work on the estimate and the quote; excluded: the quote''s "What''s not included".';
drop index public.estimate_work_items_unique;
create unique index estimate_work_items_unique
  on public.estimate_work_items (kind, coalesce(project_type, ''), lower(label));

insert into public.estimate_work_items (kind, project_type, label)
select 'excluded', null, l
from unnest(array['Extra work found once the job is opened up', 'Site toilet', 'Waste removal',
  'Appliances', 'Painting and decorating', 'Furniture and fittings not listed',
  'Planning or certification fees']) with ordinality u(l, n)
order by n;

drop function public.add_estimate_work_item(text, text);
create function public.add_estimate_work_item(p_project_type text, p_label text, p_kind text default 'included')
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_label text := regexp_replace(btrim(coalesce(p_label, ''), E' \t\r\n'), '\s+', ' ', 'g');
  v_type text := nullif(btrim(coalesce(p_project_type, '')), '');
  v_kind text := coalesce(p_kind, 'included');
  v_id uuid;
begin
  if not public.is_staff() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if char_length(v_label) not between 2 and 60 then
    raise exception 'label' using errcode = '22023';
  end if;
  if v_type is not null and v_type !~ '^[a-z][a-z0-9_]{0,39}$' then
    raise exception 'project type' using errcode = '22023';
  end if;
  if v_kind not in ('included', 'excluded') then
    raise exception 'kind' using errcode = '22023';
  end if;
  select id into v_id from public.estimate_work_items
  where kind = v_kind and coalesce(project_type, '') = coalesce(v_type, '')
    and lower(label) = lower(v_label)
  for update;
  if found then
    update public.estimate_work_items set archived_at = null where id = v_id;
    return v_id;
  end if;
  insert into public.estimate_work_items (kind, project_type, label, created_by)
  values (v_kind, v_type, v_label, (select auth.uid()))
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.add_estimate_work_item(text, text, text) from public, anon, authenticated;
grant execute on function public.add_estimate_work_item(text, text, text) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Quotes
-- ---------------------------------------------------------------------------------------------

create sequence private.quote_number_seq;

create table public.quotes (
  id uuid primary key default gen_random_uuid(),
  enquiry_id uuid not null references public.enquiries (id) on delete cascade,
  estimate_id uuid references public.estimates (id) on delete set null,
  -- Q3-Q-0001: one number per enquiry's quote, kept by its later versions.
  number text not null check (number ~ '^Q3-Q-[0-9]{4,}$'),
  version integer not null check (version >= 1),
  price_eur integer not null check (price_eur between 100 and 10000000),
  included text[] not null check (cardinality(included) between 1 and 60 and array_position(included, null) is null),
  excluded text[] not null default '{}' check (cardinality(excluded) <= 60 and array_position(excluded, null) is null),
  note text check (note is null or char_length(note) between 1 and 600),
  deposit_percent numeric(4, 1) not null default 10 check (deposit_percent > 0 and deposit_percent <= 50),
  deposit_eur integer generated always as (round(price_eur * deposit_percent / 100)::integer) stored,
  -- 15 working days after it was sent (Irish dates; public holidays not modelled yet).
  valid_until date not null,
  -- The terms paragraph exactly as sent ({date} filled in).
  terms text not null check (char_length(terms) between 1 and 1200),
  sent_at timestamptz not null default now(),
  created_by uuid references public.staff (user_id) on delete set null,
  created_by_name text,
  -- The stored PDF (bucket `quotes`), written by the worker when it sends the email.
  pdf_path text,
  change_requested_at timestamptz,
  change_request_text text check (change_request_text is null or char_length(change_request_text) between 1 and 1000),
  -- Reserved: the deposit page records nothing on opening (no writes on a link open).
  deposit_link_opened_at timestamptz,
  unique (enquiry_id, version)
);
create index quotes_by_enquiry on public.quotes (enquiry_id, version desc);
comment on table public.quotes is 'Quotes sent to the customer (newest version is current). Staff only.';

revoke all on table public.quotes from public, anon, authenticated;
grant select on table public.quotes to authenticated;
grant select, insert, update, delete on table public.quotes to service_role;
alter table public.quotes enable row level security;
create policy "staff read quotes" on public.quotes
  for select to authenticated using ((select public.is_staff()));

-- The stored PDFs: private; staff read (signed links); written by the worker (service role).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('quotes', 'quotes', false, 10485760, array['application/pdf'])
on conflict (id) do update
  set public = false, file_size_limit = 10485760, allowed_mime_types = array['application/pdf'];
create policy "staff read quote files" on storage.objects
  for select to authenticated using (bucket_id = 'quotes' and (select public.is_staff()));

alter table public.communications
  add column quote_id uuid references public.quotes (id) on delete cascade,
  drop constraint communications_template_check,
  add constraint communications_template_check check (template in (
    'booking_confirmation', 'booking_reminder', 'booking_cancelled', 'booking_rescheduled',
    'staff_new_enquiry', 'staff_callback_request', 'staff_invite', 'staff_password_reset',
    'estimate', 'staff_quote_request', 'visit_link', 'quote', 'staff_quote_change')),
  add constraint communications_quote_check check (
    (template in ('quote', 'staff_quote_change')) = (quote_id is not null));

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
    'quote_sent', 'quote_change_requested'
  ));

-- The terms paragraph's default; the same text as WORDING.quote_terms in messages.ts.
create function private.quote_terms_default()
returns text
language sql
immutable
set search_path = ''
as $$
  select 'This quote is one price for the work listed. It’s good until {date}. Work not listed is not included. If you want anything changed or added, tell us and we’ll update the quote.'::text;
$$;

-- "Fri 18 Dec 2026"
create function private.long_date(p date)
returns text
language sql
immutable
set search_path = ''
as $$
  select to_char(p, 'FMDy FMDD Mon YYYY');
$$;

-- Labels: trimmed, spaces collapsed, 2 to 60 characters, no repeats in any case.
create function private.clean_labels(p_items text[], p_max integer)
returns text[]
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_out text[] := '{}';
  v_item text;
begin
  if cardinality(coalesce(p_items, '{}')) > p_max then
    raise exception 'too many items' using errcode = '22023';
  end if;
  foreach v_item in array coalesce(p_items, '{}') loop
    v_item := regexp_replace(btrim(coalesce(v_item, ''), E' \t\r\n'), '\s+', ' ', 'g');
    if char_length(v_item) not between 2 and 60
       or exists (select 1 from unnest(v_out) x where lower(x) = lower(v_item)) then
      raise exception 'items' using errcode = '22023';
    end if;
    v_out := v_out || v_item;
  end loop;
  return v_out;
end;
$$;

-- Staff: send a quote (a new version if the enquiry has one). Returns the quote id.
create function public.send_quote(
  p_enquiry_id uuid,
  p_price integer,
  p_included text[],
  p_excluded text[] default '{}',
  p_note text default null,
  p_estimate_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_enquiry public.enquiries;
  v_email text;
  v_name text;
  v_included text[];
  v_excluded text[];
  v_note text := nullif(btrim(coalesce(p_note, ''), E' \t\r\n'), '');
  v_prev public.quotes;
  v_number text;
  v_version integer := 1;
  v_today date := (now() at time zone 'Europe/Dublin')::date;
  v_until date;
  v_terms text;
  v_id uuid;
begin
  if not public.is_staff() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_price is null or p_price not between 100 and 10000000 then
    raise exception 'price' using errcode = '22023';
  end if;
  v_included := private.clean_labels(p_included, 60);
  v_excluded := private.clean_labels(p_excluded, 60);
  if cardinality(v_included) = 0 then
    raise exception 'included' using errcode = '22023';
  end if;
  if v_note is not null and char_length(v_note) > 600 then
    raise exception 'note' using errcode = '22023';
  end if;

  select * into v_enquiry from public.enquiries where id = p_enquiry_id for update;
  if not found then
    raise exception 'enquiry not found' using errcode = 'P0002';
  end if;
  if v_enquiry.outcome in ('won', 'lost') then
    raise exception 'enquiry closed' using errcode = '22023';
  end if;
  v_email := nullif(btrim(v_enquiry.answers ->> 'email'), '');
  if v_email is null then
    raise exception 'no email address' using errcode = '22023';
  end if;
  if p_estimate_id is not null
     and not exists (select 1 from public.estimates where id = p_estimate_id and enquiry_id = p_enquiry_id) then
    raise exception 'estimate not found' using errcode = 'P0002';
  end if;

  select * into v_prev from public.quotes where enquiry_id = p_enquiry_id order by version desc limit 1;
  if found then
    v_number := v_prev.number;
    v_version := v_prev.version + 1;
  else
    v_number := 'Q3-Q-' || lpad(nextval('private.quote_number_seq')::text, 4, '0');
  end if;

  select display_name into v_name from public.staff where user_id = (select auth.uid());
  v_until := private.add_working_days(v_today, 15);
  v_terms := replace(
    coalesce(nullif(btrim((select body from public.message_blocks where key = 'quote_terms')), ''),
             private.quote_terms_default()),
    '{date}', private.long_date(v_until));

  insert into public.quotes (enquiry_id, estimate_id, number, version, price_eur, included, excluded,
    note, valid_until, terms, created_by, created_by_name)
  values (p_enquiry_id, p_estimate_id, v_number, v_version, p_price, v_included, v_excluded,
    v_note, v_until, v_terms, (select auth.uid()), v_name)
  returning id into v_id;

  -- The commercial stage, through the outcome logic the report reads.
  perform private.write_outcome(p_enquiry_id, 'quoted', p_price, v_today, null, null, true);

  insert into public.enquiry_events (enquiry_id, kind, detail, actor_user_id, actor_name)
  values (p_enquiry_id, 'quote_sent',
    format('%s%s: €%s', v_number, case when v_version > 1 then ' (version ' || v_version || ')' else '' end,
      to_char(p_price, 'FM999,999,999')),
    (select auth.uid()), v_name);

  insert into public.communications (enquiry_id, quote_id, template, recipient, dedupe_key)
  values (p_enquiry_id, v_id, 'quote', v_email, 'quote:' || v_id);
  return v_id;
end;
$$;

revoke all on function public.send_quote(uuid, integer, text[], text[], text, uuid) from public, anon, authenticated;
grant execute on function public.send_quote(uuid, integer, text[], text[], text, uuid) to authenticated;

-- Customer: "Ask for a change" (called by public-booking as postgres, after the token check).
-- Records the text on the quote (a later ask replaces it) and alerts each active staff member.
create function private.request_quote_change(p_enquiry_id uuid, p_quote_id uuid, p_text text)
returns text
language plpgsql
set search_path = ''
as $$
declare
  v public.quotes;
  v_text text := nullif(btrim(coalesce(p_text, ''), E' \t\r\n'), '');
begin
  if v_text is null or char_length(v_text) > 1000 then
    raise exception 'change text' using errcode = '22023';
  end if;
  select * into v from public.quotes where id = p_quote_id and enquiry_id = p_enquiry_id for update;
  if not found then
    return 'not_found';
  end if;
  update public.quotes set change_requested_at = now(), change_request_text = v_text where id = v.id;
  insert into public.enquiry_events (enquiry_id, kind, detail)
  values (p_enquiry_id, 'quote_change_requested', 'Change asked for on ' || v.number);
  insert into public.communications (enquiry_id, quote_id, template, recipient, dedupe_key)
  select p_enquiry_id, v.id, 'staff_quote_change', u.email,
         'staff_quote_change:' || v.id || ':' || s.user_id || ':' || (extract(epoch from clock_timestamp()) * 1000)::bigint
  from public.staff s join auth.users u on u.id = s.user_id
  where s.active and u.email is not null;
  update public.enquiries set updated_at = now() where id = p_enquiry_id;
  return 'requested';
end;
$$;

revoke all on function private.add_working_days(date, integer), private.quote_terms_default(),
  private.long_date(date), private.clean_labels(text[], integer),
  private.request_quote_change(uuid, uuid, text) from public, anon, authenticated;
revoke all on sequence private.quote_number_seq from public, anon, authenticated;
