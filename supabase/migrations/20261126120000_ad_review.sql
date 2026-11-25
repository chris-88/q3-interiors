-- Slice 6, part B: the review loop. Staff ask for changes against an ad's current version; admins
-- approve or archive; the local publish command adds version N+1 and marks requests done in it.
--
-- Write path: security-definer functions (like set_enquiry_status and the other staff actions),
-- each checking the caller's active staff row and role, and each writing an audit event. Staff
-- still have no write privileges on any ad table.

alter table public.ad_versions
  add column approved_at timestamptz,
  add column approved_by_name text;

create table public.ad_requests (
  id uuid primary key default gen_random_uuid(),
  ad_id uuid not null references public.ads (id) on delete cascade,
  version_id uuid not null references public.ad_versions (id) on delete cascade,
  size text not null default 'both' check (size in ('both', 'portrait', 'vertical', 'square')),
  body text not null check (char_length(btrim(body)) between 3 and 1000),
  state text not null default 'open' check (state in ('open', 'done', 'withdrawn')),
  done_in_version integer check ((state = 'done') = (done_in_version is not null)),
  created_by uuid references public.staff (user_id) on delete set null,
  created_by_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index ad_requests_open on public.ad_requests (ad_id) where state = 'open';

-- Who did what to an ad, for the record.
create table public.ad_events (
  id bigint generated always as identity primary key,
  ad_id uuid not null references public.ads (id) on delete cascade,
  version integer,
  kind text not null check (kind in (
    'published', 'requested', 'withdrawn', 'approved', 'archived', 'unarchived', 'request_done')),
  detail text,
  actor_name text,
  created_at timestamptz not null default now()
);

create index ad_events_by_ad on public.ad_events (ad_id, created_at);

revoke all on table public.ad_requests, public.ad_events from public, anon, authenticated;
grant select on table public.ad_requests, public.ad_events to authenticated;
grant select, insert, update, delete on table public.ad_requests, public.ad_events to service_role;
alter table public.ad_requests enable row level security;
alter table public.ad_events enable row level security;
create policy "staff read ad requests" on public.ad_requests
  for select to authenticated using ((select public.is_staff()));
create policy "staff read ad events" on public.ad_events
  for select to authenticated using ((select public.is_staff()));

-- The caller's active staff row (name and role), or an error.
create function private.ad_actor(p_admin boolean)
returns public.staff
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v public.staff;
begin
  select * into v from public.staff where user_id = (select auth.uid()) and active;
  if not found or (p_admin and v.role <> 'admin') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return v;
end;
$$;

create function private.ad_current_version(p_ad_id uuid)
returns public.ad_versions
language sql
stable
set search_path = ''
as $$
  select * from public.ad_versions where ad_id = p_ad_id order by version desc limit 1;
$$;

-- Any active staff member: ask for a change on the ad's current version.
create function public.request_ad_change(p_ad_id uuid, p_body text, p_size text default 'both')
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.staff := private.ad_actor(false);
  v_ad public.ads;
  v_version public.ad_versions;
  v_id uuid;
  v_body text := btrim(coalesce(p_body, ''));
begin
  select * into v_ad from public.ads where id = p_ad_id for update;
  if not found then
    raise exception 'ad not found' using errcode = 'P0002';
  end if;
  if v_ad.status = 'archived' then
    raise exception 'ad archived' using errcode = '22023';
  end if;
  if char_length(v_body) < 3 or char_length(v_body) > 1000 then
    raise exception 'request length' using errcode = '22023';
  end if;
  if coalesce(p_size, 'both') not in ('both', 'portrait', 'vertical', 'square') then
    raise exception 'size' using errcode = '22023';
  end if;
  v_version := private.ad_current_version(p_ad_id);
  insert into public.ad_requests (ad_id, version_id, size, body, created_by, created_by_name)
  values (p_ad_id, v_version.id, coalesce(p_size, 'both'), v_body, v_actor.user_id, v_actor.display_name)
  returning id into v_id;
  update public.ads set status = 'changes_requested', updated_at = now() where id = p_ad_id;
  insert into public.ad_events (ad_id, version, kind, detail, actor_name)
  values (p_ad_id, v_version.version, 'requested', left(v_body, 200), v_actor.display_name);
  return v_id;
end;
$$;

-- The person who asked: withdraw their own open request. With nothing else open on the current
-- version the ad goes back to waiting for review.
create function public.withdraw_ad_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.staff := private.ad_actor(false);
  v_request public.ad_requests;
  v_version public.ad_versions;
begin
  select * into v_request from public.ad_requests where id = p_request_id for update;
  if not found then
    raise exception 'request not found' using errcode = 'P0002';
  end if;
  if v_request.created_by is distinct from v_actor.user_id then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if v_request.state <> 'open' then
    raise exception 'request not open' using errcode = '22023';
  end if;
  update public.ad_requests set state = 'withdrawn', updated_at = now() where id = p_request_id;
  v_version := private.ad_current_version(v_request.ad_id);
  if not exists (
    select 1 from public.ad_requests where version_id = v_version.id and state = 'open'
  ) then
    update public.ads set status = 'new', updated_at = now()
    where id = v_request.ad_id and status = 'changes_requested';
  end if;
  insert into public.ad_events (ad_id, version, kind, detail, actor_name)
  select v_request.ad_id, v.version, 'withdrawn', left(v_request.body, 200), v_actor.display_name
  from public.ad_versions v where v.id = v_request.version_id;
end;
$$;

-- Admins: approve the current version. Open requests on it need an explicit confirmation.
create function public.approve_ad(p_ad_id uuid, p_version integer, p_despite_open boolean default false)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.staff := private.ad_actor(true);
  v_ad public.ads;
  v_version public.ad_versions;
begin
  select * into v_ad from public.ads where id = p_ad_id for update;
  if not found then
    raise exception 'ad not found' using errcode = 'P0002';
  end if;
  if v_ad.status = 'archived' then
    raise exception 'ad archived' using errcode = '22023';
  end if;
  v_version := private.ad_current_version(p_ad_id);
  if v_version.version is distinct from p_version then
    raise exception 'not the current version' using errcode = '22023';
  end if;
  if not coalesce(p_despite_open, false) and exists (
    select 1 from public.ad_requests where version_id = v_version.id and state = 'open'
  ) then
    raise exception 'open requests' using errcode = '22023';
  end if;
  update public.ad_versions set approved_at = now(), approved_by_name = v_actor.display_name
  where id = v_version.id;
  update public.ads set status = 'approved', updated_at = now() where id = p_ad_id;
  insert into public.ad_events (ad_id, version, kind, detail, actor_name)
  values (p_ad_id, v_version.version, 'approved', null, v_actor.display_name);
end;
$$;

-- Admins: archive an ad, or bring it back (approved if its current version was, else new).
create function public.archive_ad(p_ad_id uuid, p_archived boolean default true)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.staff := private.ad_actor(true);
  v_version public.ad_versions;
begin
  if not exists (select 1 from public.ads where id = p_ad_id) then
    raise exception 'ad not found' using errcode = 'P0002';
  end if;
  v_version := private.ad_current_version(p_ad_id);
  update public.ads
  set status = case
        when p_archived then 'archived'::public.ad_status
        when v_version.approved_at is not null then 'approved'::public.ad_status
        when exists (select 1 from public.ad_requests where version_id = v_version.id and state = 'open')
          then 'changes_requested'::public.ad_status
        else 'new'::public.ad_status
      end,
      updated_at = now()
  where id = p_ad_id;
  insert into public.ad_events (ad_id, version, kind, detail, actor_name)
  values (p_ad_id, v_version.version, case when p_archived then 'archived' else 'unarchived' end,
          null, v_actor.display_name);
end;
$$;

-- The publish command (service role only): after inserting version N and its variants, mark the
-- named open requests done in it and put the ad back to waiting for review.
create function public.record_ad_version(p_version_id uuid, p_request_ids uuid[] default '{}', p_actor text default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_version public.ad_versions;
  v_done integer;
begin
  select * into v_version from public.ad_versions where id = p_version_id;
  if not found then
    raise exception 'version not found' using errcode = 'P0002';
  end if;
  if exists (
    select 1 from unnest(coalesce(p_request_ids, '{}')) r(id)
    where not exists (select 1 from public.ad_requests q where q.id = r.id and q.ad_id = v_version.ad_id and q.state = 'open')
  ) then
    raise exception 'unknown or closed request' using errcode = '22023';
  end if;
  update public.ad_requests
  set state = 'done', done_in_version = v_version.version, updated_at = now()
  where id = any (coalesce(p_request_ids, '{}'));
  get diagnostics v_done = row_count;
  update public.ads set status = 'new', updated_at = now() where id = v_version.ad_id;
  insert into public.ad_events (ad_id, version, kind, detail, actor_name)
  values (v_version.ad_id, v_version.version, 'published', null, p_actor);
  insert into public.ad_events (ad_id, version, kind, detail, actor_name)
  select v_version.ad_id, v_version.version, 'request_done', left(body, 200), p_actor
  from public.ad_requests where id = any (coalesce(p_request_ids, '{}'));
  return v_done;
end;
$$;

revoke all on function public.request_ad_change(uuid, text, text) from public, anon, authenticated;
revoke all on function public.withdraw_ad_request(uuid) from public, anon, authenticated;
revoke all on function public.approve_ad(uuid, integer, boolean) from public, anon, authenticated;
revoke all on function public.archive_ad(uuid, boolean) from public, anon, authenticated;
revoke all on function public.record_ad_version(uuid, uuid[], text) from public, anon, authenticated;
grant execute on function public.request_ad_change(uuid, text, text) to authenticated;
grant execute on function public.withdraw_ad_request(uuid) to authenticated;
grant execute on function public.approve_ad(uuid, integer, boolean) to authenticated;
grant execute on function public.archive_ad(uuid, boolean) to authenticated;
grant execute on function public.record_ad_version(uuid, uuid[], text) to service_role;
revoke all on all functions in schema private from public, anon, authenticated;
grant execute on all functions in schema private to service_role;

-- The sample ad (and any ad published before this) gets its publish event.
insert into public.ad_events (ad_id, version, kind, actor_name, created_at)
select v.ad_id, v.version, 'published', v.created_by_name, v.created_at
from public.ad_versions v;
