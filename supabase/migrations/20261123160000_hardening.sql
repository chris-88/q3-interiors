-- Slice 4 part A: abuse limits, honeypot, staff alerts, deletion for data requests, retention.

-- ---------------------------------------------------------------------------------------------
-- Settings: limits (changed by SQL only) and retention (staff; NULL = off)
-- ---------------------------------------------------------------------------------------------

alter table public.booking_settings
  add column enquiry_limit_per_hour integer not null default 5 check (enquiry_limit_per_hour between 1 and 1000),
  add column booking_write_limit_per_hour integer not null default 20 check (booking_write_limit_per_hour between 1 and 1000),
  add column booking_read_limit_per_hour integer not null default 300 check (booking_read_limit_per_hour between 1 and 10000),
  -- Delete enquiries older than this many months unless won. NULL: retention is off.
  add column retention_months integer check (retention_months is null or retention_months between 1 and 120);

grant update (retention_months) on public.booking_settings to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Rate limits: a keyed hash of the client address, never the address. Rows live under 25 hours.
-- ---------------------------------------------------------------------------------------------

create table private.rate_limit_hits (
  id bigint generated always as identity primary key,
  bucket text not null check (bucket in ('enquiry', 'booking_write', 'booking_read')),
  addr_hash text not null,
  -- The request's idempotency key, so a retry of the same request is not counted twice.
  idem_key text,
  created_at timestamptz not null default now()
);
create index rate_limit_hits_window on private.rate_limit_hits (bucket, addr_hash, created_at);
create unique index rate_limit_hits_once on private.rate_limit_hits (bucket, addr_hash, idem_key)
  where idem_key is not null;
alter table private.rate_limit_hits enable row level security;

-- HMAC-SHA256 of the address with the worker secret (Vault). The functions compute the same
-- hash with the same secret (Q3_WORKER_SECRET), so one address maps to one bucket everywhere.
create function private.address_hash(p_address text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_key text;
begin
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'q3_worker_secret';
  if v_key is null then
    raise exception 'rate limit key missing from vault' using errcode = '55000';
  end if;
  return encode(extensions.hmac(coalesce(p_address, 'shared'), v_key, 'sha256'), 'hex');
end;
$$;

-- The client address of the current PostgREST request: Cloudflare's cf-connecting-ip (the
-- origin is only reachable through the tunnel), else the first x-forwarded-for hop, else one
-- shared bucket for everyone rather than no limit.
create function private.request_address()
returns text
language sql
stable
set search_path = ''
as $$
  select coalesce(
    nullif(btrim(h ->> 'cf-connecting-ip'), ''),
    nullif(btrim(split_part(h ->> 'x-forwarded-for', ',', 1)), ''),
    'shared')
  from (select coalesce(nullif(current_setting('request.headers', true), ''), '{}')::json as h) s;
$$;

-- Take one unit from a bucket. True if allowed (and recorded), false if over the limit.
create function private.rate_limit_take(p_bucket text, p_addr_hash text, p_idem_key text, p_limit integer)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_count integer;
begin
  if p_idem_key is not null and exists (
    select 1 from private.rate_limit_hits
    where bucket = p_bucket and addr_hash = p_addr_hash and idem_key = p_idem_key
  ) then
    return true;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_bucket || ':' || p_addr_hash, 0));
  select count(*) into v_count from private.rate_limit_hits
  where bucket = p_bucket and addr_hash = p_addr_hash and created_at > now() - interval '1 hour';
  if v_count >= p_limit then
    return false;
  end if;
  insert into private.rate_limit_hits (bucket, addr_hash, idem_key)
  values (p_bucket, p_addr_hash, p_idem_key)
  on conflict do nothing;
  return true;
end;
$$;

create function private.purge_rate_limits()
returns integer
language sql
set search_path = ''
as $$
  with gone as (
    delete from private.rate_limit_hits where created_at < now() - interval '24 hours' returning 1
  )
  select count(*)::integer from gone;
$$;

-- ---------------------------------------------------------------------------------------------
-- Staff alerts through the communications queue, once per enquiry and staff member
-- ---------------------------------------------------------------------------------------------

alter table public.communications drop constraint communications_template_check;
alter table public.communications
  add constraint communications_template_check check (template in (
    'booking_confirmation', 'booking_reminder', 'booking_cancelled', 'booking_rescheduled',
    'staff_new_enquiry', 'staff_callback_request'));

create function private.queue_staff_alert(p_enquiry_id uuid, p_template text)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.communications (enquiry_id, template, recipient, dedupe_key)
  select p_enquiry_id, p_template, u.email, p_template || ':' || p_enquiry_id || ':' || s.user_id
  from public.staff s
  join auth.users u on u.id = s.user_id
  where u.email is not null
  on conflict (dedupe_key) do nothing;
$$;

create or replace function private.request_contact(p_enquiry_id uuid, p_reason text)
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
  perform private.queue_staff_alert(p_enquiry_id, 'staff_callback_request');
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Submission: limit per address, honeypot, alert. Replaces the slice 2 signature (one new
-- defaulted parameter, so existing callers still resolve). submit_enquiry is no longer
-- callable by anon: everything goes through the limit.
-- ---------------------------------------------------------------------------------------------

drop function public.submit_enquiry_with_access(uuid, text, integer, jsonb, boolean, jsonb);

create function public.submit_enquiry_with_access(
  p_idempotency_key uuid,
  p_form_id text,
  p_form_version integer,
  p_answers jsonb,
  p_marketing_opt_in boolean default false,
  p_attribution jsonb default null,
  -- A field people never see. Anything in it means a bot: answer normally, store nothing.
  p_trap text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reference text;
  v_id uuid;
  v_limit integer;
  c_alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
begin
  -- A retry of a saved enquiry is not a new submission: no limit, same reference.
  select id, reference into v_id, v_reference from public.enquiries where idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object('reference', v_reference) || private.mint_enquiry_token(v_id);
  end if;

  select enquiry_limit_per_hour into v_limit from public.booking_settings limit 1;
  if not private.rate_limit_take('enquiry', private.address_hash(private.request_address()),
                                 p_idempotency_key::text, coalesce(v_limit, 5)) then
    raise sqlstate 'PT429' using message = 'rate_limited',
      hint = 'Too many enquiries from this address. Please try again later.';
  end if;

  if nullif(btrim(coalesce(p_trap, '')), '') is not null then
    return jsonb_build_object(
      'reference', 'Q3-' || (
        select string_agg(substr(c_alphabet, 1 + floor(random() * length(c_alphabet))::integer, 1), '')
        from generate_series(1, 6)),
      'access_token', null,
      'expires_at', null);
  end if;

  v_reference := public.submit_enquiry(
    p_idempotency_key, p_form_id, p_form_version, p_answers, p_marketing_opt_in, p_attribution);
  select id into v_id from public.enquiries where idempotency_key = p_idempotency_key;
  perform private.queue_staff_alert(v_id, 'staff_new_enquiry');
  return jsonb_build_object('reference', v_reference) || private.mint_enquiry_token(v_id);
end;
$$;

revoke all on function public.submit_enquiry(uuid, text, integer, jsonb, boolean, jsonb) from public, anon, authenticated;
revoke all on function public.submit_enquiry_with_access(uuid, text, integer, jsonb, boolean, jsonb, text) from public, anon, authenticated;
grant execute on function public.submit_enquiry_with_access(uuid, text, integer, jsonb, boolean, jsonb, text) to anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- Deletion (data requests and retention)
-- ---------------------------------------------------------------------------------------------

-- Who deleted which reference, when and why. No personal data.
create table public.deletion_log (
  id bigint generated always as identity primary key,
  reference text not null,
  reason text not null check (reason in ('staff_request', 'retention')),
  deleted_by_name text,
  deleted_at timestamptz not null default now()
);

-- Google events still to remove after their booking rows are gone.
create table private.pending_event_deletions (
  calendar_event_id text primary key,
  staff_user_id uuid not null,
  attempts integer not null default 0,
  last_error text,
  next_attempt_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
alter table private.pending_event_deletions enable row level security;

create function private.delete_enquiry_data(p_enquiry_id uuid, p_reason text, p_actor_name text)
returns text
language plpgsql
set search_path = ''
as $$
declare
  v_reference text;
begin
  select reference into v_reference from public.enquiries where id = p_enquiry_id for update;
  if not found then
    return null;
  end if;
  -- Any event that was (or may have been) created and not already removed goes to the queue.
  insert into private.pending_event_deletions (calendar_event_id, staff_user_id)
  select b.calendar_event_id, b.staff_user_id
  from public.bookings b
  where b.enquiry_id = p_enquiry_id
    and exists (select 1 from public.integration_jobs j
                where j.booking_id = b.id and j.kind = 'create_calendar_event'
                  and (j.state = 'succeeded' or j.outcome_unknown or j.attempts > 0))
    and not exists (select 1 from public.integration_jobs j
                    where j.booking_id = b.id and j.kind = 'delete_calendar_event' and j.state = 'succeeded')
  on conflict do nothing;
  insert into public.deletion_log (reference, reason, deleted_by_name)
  values (v_reference, p_reason, p_actor_name);
  -- Cascades to revisions, attribution, history, bookings, jobs, messages (queued or not) and
  -- access tokens.
  delete from public.enquiries where id = p_enquiry_id;
  return v_reference;
end;
$$;

-- Staff action for a data request. The typed reference must match.
create function public.delete_enquiry(p_enquiry_id uuid, p_confirm_reference text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
  v_reference text;
begin
  select display_name into v_name from public.staff where user_id = (select auth.uid());
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
$$;

create function private.retention_candidates(p_months integer)
returns setof uuid
language sql
stable
set search_path = ''
as $$
  select id from public.enquiries
  where p_months is not null
    and submitted_at < now() - make_interval(months => p_months)
    and outcome is distinct from 'won';
$$;

-- What the next retention run would delete: with the saved setting, or a proposed value.
create function public.retention_preview(p_months integer default null)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_staff() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return (select count(*) from private.retention_candidates(
    coalesce(p_months, (select retention_months from public.booking_settings limit 1))));
end;
$$;

-- Daily. Does nothing while retention_months is NULL.
create function private.run_retention()
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_months integer;
  v_id uuid;
  v_count integer := 0;
begin
  select retention_months into v_months from public.booking_settings limit 1;
  if v_months is null then
    return 0;
  end if;
  for v_id in select * from private.retention_candidates(v_months) loop
    perform private.delete_enquiry_data(v_id, 'retention', null);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- Worker side of pending event deletions.
create function private.claim_event_deletions(p_limit integer)
returns setof private.pending_event_deletions
language sql
set search_path = ''
as $$
  update private.pending_event_deletions d
  set attempts = d.attempts + 1, next_attempt_at = now() + interval '5 minutes'
  where d.calendar_event_id in (
    select calendar_event_id from private.pending_event_deletions
    where next_attempt_at <= now() and attempts < 12
    order by created_at
    for update skip locked
    limit p_limit
  )
  returning d.*;
$$;

create function private.event_deletion_done(p_event_id text)
returns void
language sql
set search_path = ''
as $$
  delete from private.pending_event_deletions where calendar_event_id = p_event_id;
$$;

create function private.event_deletion_failed(p_event_id text, p_error text)
returns void
language sql
set search_path = ''
as $$
  update private.pending_event_deletions
  set last_error = left(p_error, 300),
      next_attempt_at = now() + make_interval(mins => least(60, 5 * attempts))
  where calendar_event_id = p_event_id;
$$;

-- Staff can see how many removals are still waiting (no identifiers beyond the event id).
create function public.pending_event_deletion_count()
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_staff() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return (select count(*) from private.pending_event_deletions where attempts >= 3);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Schedules
-- ---------------------------------------------------------------------------------------------

select cron.schedule('q3-purge-rate-limits', '7 * * * *', 'select private.purge_rate_limits()');
select cron.schedule('q3-retention', '15 3 * * *', 'select private.run_retention()');

-- ---------------------------------------------------------------------------------------------
-- Privileges and RLS
-- ---------------------------------------------------------------------------------------------

revoke all on all tables in schema private from public, anon, authenticated;
revoke all on all functions in schema private from public, anon, authenticated;
grant all on all tables in schema private to service_role;
grant execute on all functions in schema private to service_role;

revoke all on table public.deletion_log from public, anon, authenticated;
grant select on table public.deletion_log to authenticated;
grant select, insert on table public.deletion_log to service_role;
revoke all on sequence public.deletion_log_id_seq from public, anon, authenticated;
alter table public.deletion_log enable row level security;
create policy "staff read deletion log" on public.deletion_log
  for select to authenticated using ((select public.is_staff()));

revoke all on function public.delete_enquiry(uuid, text) from public, anon, authenticated;
revoke all on function public.retention_preview(integer) from public, anon, authenticated;
revoke all on function public.pending_event_deletion_count() from public, anon, authenticated;
grant execute on function public.delete_enquiry(uuid, text) to authenticated;
grant execute on function public.retention_preview(integer) to authenticated;
grant execute on function public.pending_event_deletion_count() to authenticated;
