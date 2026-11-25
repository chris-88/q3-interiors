-- Enquiry form v2, part B: "Help us prepare (optional)" after booking.
--
-- Everything here is written by the public-booking function (as postgres, for the enquiry its
-- token resolves to) through the private functions below. Anon gets nothing new: no table, no
-- function, no storage access. Staff read through RLS and the storage policy.
--
-- * Rough budget and desired work start: the published form `prepare@1` (ids and values from
--   enquiry v1), stored as a revision and as `enquiries.prepare_details`.
-- * Visit access notes: the site details (`site_details.access_notes`, published form
--   site_details@1), as a new site_details revision.
-- * News and offers: the same consent record v1 used (`marketing_opt_in`, `marketing_opt_in_at`).
-- * Photos: `enquiry_photos` rows plus JPEG files in the private `enquiry-photos` bucket. Only the
--   service role writes files (the function, after checking the token, the booking, the count
--   and the bytes). Deleting a row, directly or by the enquiry's deletion, queues its file for
--   removal through the storage API (Postgres may not delete storage objects itself).
-- * Changes are allowed while the enquiry has a live booking that has not started.

alter table public.enquiries
  add column prepare_details jsonb
    check (prepare_details is null or jsonb_typeof(prepare_details) = 'object'),
  add column prepare_form_version integer,
  -- Last time the customer added or changed anything after booking (staff marker).
  add column added_after_booking_at timestamptz;

alter table public.enquiry_events drop constraint enquiry_events_kind_check;
alter table public.enquiry_events
  add constraint enquiry_events_kind_check check (kind in (
    'submitted', 'status_changed', 'site_details_added', 'contact_requested',
    'booking_requested', 'booking_confirmed', 'booking_failed', 'booking_retrying',
    'email_sent', 'email_failed',
    'booking_cancelled', 'booking_rescheduled', 'calendar_updated', 'calendar_update_failed',
    'attendance_recorded', 'outcome_recorded', 'outcome_cleared',
    'details_updated', 'prepare_updated', 'photo_added', 'photo_removed'
  ));

-- ---------------------------------------------------------------------------------------------
-- Photos: rows, private bucket, deletion queue
-- ---------------------------------------------------------------------------------------------

create table public.enquiry_photos (
  id uuid primary key default gen_random_uuid(),
  enquiry_id uuid not null references public.enquiries (id) on delete cascade,
  -- The browser's key for this photo: a retried upload lands on the same row and file.
  idempotency_key uuid not null unique,
  object_path text not null unique
    check (object_path ~ '^enquiries/[0-9a-f-]{36}/[0-9a-f-]{36}\.jpg$'),
  bytes integer not null check (bytes between 1 and 2097152),
  width integer not null check (width between 1 and 4096),
  height integer not null check (height between 1 and 4096),
  -- A small JPEG made in the browser and checked like the photo; shown to the customer and staff.
  thumb_jpeg bytea not null check (octet_length(thumb_jpeg) between 4 and 40000),
  -- Null until the file is stored; such rows are hidden and purged after an hour.
  uploaded_at timestamptz,
  created_at timestamptz not null default now()
);

create index enquiry_photos_by_enquiry on public.enquiry_photos (enquiry_id, created_at);

revoke all on table public.enquiry_photos from public, anon, authenticated;
grant select on table public.enquiry_photos to authenticated;
grant select, insert, update, delete on table public.enquiry_photos to service_role;
alter table public.enquiry_photos enable row level security;
create policy "staff read enquiry photos" on public.enquiry_photos
  for select to authenticated using ((select public.is_staff()) and uploaded_at is not null);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('enquiry-photos', 'enquiry-photos', false, 2097152, array['image/jpeg'])
on conflict (id) do update
  set public = false, file_size_limit = 2097152, allowed_mime_types = array['image/jpeg'];

create policy "staff read enquiry photo files" on storage.objects
  for select to authenticated
  using (bucket_id = 'enquiry-photos' and (select public.is_staff()));

-- Files whose rows are gone, removed by the worker through the storage API.
create table private.pending_photo_deletions (
  object_path text primary key,
  attempts integer not null default 0,
  last_error text,
  next_attempt_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
alter table private.pending_photo_deletions enable row level security;

create function private.queue_photo_file_deletion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into private.pending_photo_deletions (object_path) values (old.object_path)
  on conflict (object_path) do update set next_attempt_at = now();
  return old;
end;
$$;

-- Fires for every way a row goes: removal by the customer, a stale pending row, and the cascade
-- from deleting the enquiry (staff data request or retention).
create trigger enquiry_photos_queue_file_deletion
  after delete on public.enquiry_photos
  for each row execute function private.queue_photo_file_deletion();

create function private.claim_photo_deletions(p_limit integer)
returns setof text
language sql
set search_path = ''
as $$
  update private.pending_photo_deletions d
  set attempts = d.attempts + 1,
      next_attempt_at = now() + least(interval '1 hour', interval '30 seconds' * power(2, d.attempts))
  where d.object_path in (
    select object_path from private.pending_photo_deletions
    where next_attempt_at <= now()
    order by created_at
    limit p_limit
    for update skip locked)
  returning d.object_path;
$$;

create function private.photo_deletion_done(p_paths text[])
returns void
language sql
set search_path = ''
as $$
  delete from private.pending_photo_deletions where object_path = any (p_paths);
$$;

create function private.photo_deletion_failed(p_path text, p_error text)
returns void
language sql
set search_path = ''
as $$
  update private.pending_photo_deletions set last_error = left(p_error, 300) where object_path = p_path;
$$;

-- A row reserved but never stored (an upload abandoned mid-way) frees its place after an hour.
create function private.purge_stale_photos()
returns integer
language sql
set search_path = ''
as $$
  with gone as (
    delete from public.enquiry_photos
    where uploaded_at is null and created_at < now() - interval '1 hour'
    returning 1)
  select count(*)::integer from gone;
$$;

select cron.schedule('q3-purge-stale-photos', '37 * * * *', 'select private.purge_stale_photos()');

-- ---------------------------------------------------------------------------------------------
-- When changes are allowed, and what the page shows
-- ---------------------------------------------------------------------------------------------

-- Open while the enquiry's latest live booking has not started. Returns the booking's mode too.
create function private.prepare_window(p_enquiry_id uuid)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_start timestamptz;
  v_mode text;
begin
  select b.starts_at, t.mode into v_start, v_mode
  from public.bookings b
  join public.appointment_types t on t.id = b.appointment_type_id
  where b.enquiry_id = p_enquiry_id and b.state in ('reserved', 'calendar_pending', 'confirmed')
  order by b.created_at desc
  limit 1;
  if not found then
    return jsonb_build_object('open', false, 'reason', 'no_booking', 'mode', null);
  end if;
  if v_start <= now() then
    return jsonb_build_object('open', false, 'reason', 'started', 'mode', v_mode);
  end if;
  return jsonb_build_object('open', true, 'reason', null, 'mode', v_mode);
end;
$$;

create function private.prepare_state(p_enquiry_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'window', private.prepare_window(e.id),
    'answers', coalesce(e.prepare_details, '{}'::jsonb),
    'access_notes', e.site_details ->> 'access_notes',
    'marketing_opt_in', e.marketing_opt_in,
    'max_photos', 8,
    'photos', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', p.id, 'thumb', encode(p.thumb_jpeg, 'base64'), 'added_at', p.uploaded_at)
             order by p.created_at)
      from public.enquiry_photos p
      where p.enquiry_id = e.id and p.uploaded_at is not null), '[]'::jsonb))
  from public.enquiries e
  where e.id = p_enquiry_id;
$$;

-- ---------------------------------------------------------------------------------------------
-- Saving answers, notes and consent (each on its own)
-- ---------------------------------------------------------------------------------------------

-- p_patch: any of budget, timing (strings; '' clears), access_notes (string; '' clears; site
-- visits only), marketing_opt_in (boolean). Returns {status: saved | closed}.
create function private.save_prepare(p_enquiry_id uuid, p_patch jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_window jsonb := private.prepare_window(p_enquiry_id);
  v_enquiry public.enquiries;
  v_schema jsonb;
  v_version integer;
  v_clean jsonb;
  v_changed text[] := '{}';
  v_notes text;
  v_site jsonb;
  v_flag boolean;
begin
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' or p_patch = '{}'::jsonb
     or exists (select 1 from jsonb_object_keys(p_patch) k
                where k not in ('budget', 'timing', 'access_notes', 'marketing_opt_in'))
     or (p_patch ? 'marketing_opt_in' and jsonb_typeof(p_patch -> 'marketing_opt_in') <> 'boolean')
     or exists (select 1 from jsonb_each(p_patch - 'marketing_opt_in') e
                where jsonb_typeof(e.value) <> 'string') then
    raise exception 'invalid details' using errcode = '22023';
  end if;
  if not (v_window ->> 'open')::boolean then
    return jsonb_build_object('status', 'closed', 'reason', v_window ->> 'reason');
  end if;

  select * into v_enquiry from public.enquiries where id = p_enquiry_id for update;

  if p_patch ? 'budget' or p_patch ? 'timing' then
    select schema, version into v_schema, v_version
    from public.form_versions where form_id = 'prepare' order by version desc limit 1;
    v_clean := private.clean_answers(
      v_schema,
      coalesce(v_enquiry.prepare_details, '{}'::jsonb) || (p_patch - 'access_notes' - 'marketing_opt_in'));
    if v_clean is distinct from coalesce(v_enquiry.prepare_details, '{}'::jsonb) then
      insert into public.enquiry_revisions (enquiry_id, revision, form_id, form_version, answers, author)
      select p_enquiry_id, coalesce(max(revision), 0) + 1, 'prepare', v_version, v_clean, 'customer'
      from public.enquiry_revisions where enquiry_id = p_enquiry_id;
      update public.enquiries
      set prepare_details = v_clean, prepare_form_version = v_version
      where id = p_enquiry_id;
      if (v_clean -> 'budget') is distinct from (v_enquiry.prepare_details -> 'budget') then
        v_changed := array_append(v_changed, 'Rough budget');
      end if;
      if (v_clean -> 'timing') is distinct from (v_enquiry.prepare_details -> 'timing') then
        v_changed := array_append(v_changed, 'Work start');
      end if;
    end if;
  end if;

  if p_patch ? 'access_notes' then
    if v_window ->> 'mode' <> 'on_site' then
      raise exception 'access notes are for site visits' using errcode = '22023';
    end if;
    v_notes := nullif(btrim(p_patch ->> 'access_notes'), '');
    v_site := v_enquiry.site_details;
    if (v_site ->> 'access_notes') is distinct from v_notes then
      perform private.save_site_details(
        p_enquiry_id,
        jsonb_build_object('site_address', v_site -> 'site_address')
          || case when v_notes is null then '{}'::jsonb
                  else jsonb_build_object('access_notes', v_notes) end);
      v_changed := array_append(v_changed, 'Access notes');
    end if;
  end if;

  if p_patch ? 'marketing_opt_in' then
    v_flag := (p_patch ->> 'marketing_opt_in')::boolean;
    if v_flag is distinct from v_enquiry.marketing_opt_in then
      update public.enquiries
      set marketing_opt_in = v_flag, marketing_opt_in_at = case when v_flag then now() end
      where id = p_enquiry_id;
      v_changed := array_append(v_changed, case when v_flag then 'News and offers: asked for'
                                     else 'News and offers: stopped' end);
    end if;
  end if;

  if cardinality(v_changed) > 0 then
    update public.enquiries
    set added_after_booking_at = now(), updated_at = now()
    where id = p_enquiry_id;
    insert into public.enquiry_events (enquiry_id, kind, detail)
    values (p_enquiry_id, 'prepare_updated', array_to_string(v_changed, ', '));
  end if;
  return jsonb_build_object('status', 'saved');
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Photos: reserve a place, mark it stored, remove it
-- ---------------------------------------------------------------------------------------------

-- Returns {status: reserved | stored (a retry of a stored photo) | limit | closed | forbidden,
-- id, path}. The function then stores the file and calls photo_stored.
create function private.reserve_photo(
  p_enquiry_id uuid, p_key uuid, p_bytes integer, p_width integer, p_height integer, p_thumb bytea)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_photo public.enquiry_photos;
  v_window jsonb;
  v_id uuid := gen_random_uuid();
begin
  select * into v_photo from public.enquiry_photos where idempotency_key = p_key;
  if found then
    if v_photo.enquiry_id <> p_enquiry_id then
      return jsonb_build_object('status', 'forbidden');
    end if;
    return jsonb_build_object(
      'status', case when v_photo.uploaded_at is null then 'reserved' else 'stored' end,
      'id', v_photo.id, 'path', v_photo.object_path);
  end if;

  v_window := private.prepare_window(p_enquiry_id);
  if not (v_window ->> 'open')::boolean then
    return jsonb_build_object('status', 'closed', 'reason', v_window ->> 'reason');
  end if;
  -- Serialise uploads for one enquiry so the count holds under parallel requests.
  perform 1 from public.enquiries where id = p_enquiry_id for update;
  if (select count(*) from public.enquiry_photos where enquiry_id = p_enquiry_id) >= 8 then
    return jsonb_build_object('status', 'limit');
  end if;
  insert into public.enquiry_photos
    (id, enquiry_id, idempotency_key, object_path, bytes, width, height, thumb_jpeg)
  values
    (v_id, p_enquiry_id, p_key, 'enquiries/' || p_enquiry_id || '/' || v_id || '.jpg',
     p_bytes, p_width, p_height, p_thumb)
  returning * into v_photo;
  return jsonb_build_object('status', 'reserved', 'id', v_photo.id, 'path', v_photo.object_path);
end;
$$;

create function private.photo_stored(p_enquiry_id uuid, p_photo_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
begin
  update public.enquiry_photos set uploaded_at = now()
  where id = p_photo_id and enquiry_id = p_enquiry_id and uploaded_at is null;
  if found then
    update public.enquiries set added_after_booking_at = now(), updated_at = now()
    where id = p_enquiry_id;
    insert into public.enquiry_events (enquiry_id, kind) values (p_enquiry_id, 'photo_added');
  end if;
end;
$$;

-- Returns {status: removed | not_found | closed, path}. The row's file is queued by the trigger.
create function private.remove_photo(p_enquiry_id uuid, p_photo_id uuid)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_window jsonb := private.prepare_window(p_enquiry_id);
  v_path text;
begin
  if not (v_window ->> 'open')::boolean then
    return jsonb_build_object('status', 'closed', 'reason', v_window ->> 'reason');
  end if;
  delete from public.enquiry_photos
  where id = p_photo_id and enquiry_id = p_enquiry_id
  returning object_path into v_path;
  if v_path is null then
    return jsonb_build_object('status', 'not_found');
  end if;
  update public.enquiries set added_after_booking_at = now(), updated_at = now()
  where id = p_enquiry_id;
  insert into public.enquiry_events (enquiry_id, kind) values (p_enquiry_id, 'photo_removed');
  return jsonb_build_object('status', 'removed', 'path', v_path);
end;
$$;

revoke all on function private.queue_photo_file_deletion() from public;
revoke all on function private.claim_photo_deletions(integer) from public;
revoke all on function private.photo_deletion_done(text[]) from public;
revoke all on function private.photo_deletion_failed(text, text) from public;
revoke all on function private.purge_stale_photos() from public;
revoke all on function private.prepare_window(uuid) from public;
revoke all on function private.prepare_state(uuid) from public;
revoke all on function private.save_prepare(uuid, jsonb) from public;
revoke all on function private.reserve_photo(uuid, uuid, integer, integer, integer, bytea) from public;
revoke all on function private.photo_stored(uuid, uuid) from public;
revoke all on function private.remove_photo(uuid, uuid) from public;
