-- Part B ("Help us prepare") checks against the real database, in one transaction that is always
-- rolled back. Run with `npm run test:db` (after published.sql has published prepare@1).
begin;

create function pg_temp.expect_error(p_sql text, p_code text) returns void
language plpgsql as $$
begin
  execute p_sql;
  raise exception 'expected error % from: %', p_code, p_sql;
exception when others then
  if sqlstate <> p_code then
    raise exception 'expected error % but got % (%) from: %', p_code, sqlstate, sqlerrm, p_sql;
  end if;
end;
$$;
create function pg_temp.expect(p_ok boolean, p_what text) returns void
language plpgsql as $$
begin
  if not coalesce(p_ok, false) then
    raise exception 'expectation failed: %', p_what;
  end if;
end;
$$;
create function pg_temp.as_user(p_id text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated')::text, true)
$$;
grant execute on all functions in schema pg_temp to anon, authenticated;

create temp table r (name text primary key, value jsonb);
grant all on r to anon, authenticated, service_role;
update public.booking_settings set enquiry_limit_per_hour = 100;

select pg_temp.expect(
  exists (select 1 from public.form_versions where form_id = 'prepare' and version = 1),
  'prepare@1 is published');
select pg_temp.expect(public.bookable_staff() is not null, 'a bookable staff member exists');

create function pg_temp.slot(p_days integer, p_hour integer) returns timestamptz language sql as $$
  select ((current_date + p_days)::timestamp + make_interval(hours => p_hour)) at time zone 'Europe/Dublin'
$$;
create function pg_temp.id(p_name text) returns uuid language sql as $$
  select (value #>> '{}')::uuid from r where name = p_name
$$;
-- A tiny JPEG-shaped thumbnail (the function checks the real bytes; here only the row rules).
create function pg_temp.thumb() returns bytea language sql as $$
  select decode('ffd8ffd9', 'hex')
$$;

-- Two v2 enquiries: a visit (booked) and a call (booked, then cancelled), and one never booked.
create function pg_temp.enquiry(p_key text, p_route text, p_email text) returns uuid language plpgsql as $$
declare v jsonb;
begin
  v := public.submit_enquiry_with_access(p_key::uuid, 'enquiry', 2,
    jsonb_build_object('appointment_preference', p_route, 'project_type', 'kitchen',
      'location', 'Dublin 8', 'name', 'Test Person', 'email', p_email, 'phone', '087 123 4567')
    || case when p_route = 'on_site' then '{"site_street": "12 Example Road"}'::jsonb else '{}'::jsonb end);
  return (select id from public.enquiries where reference = v ->> 'reference');
end;
$$;
insert into r values ('visit', to_jsonb(pg_temp.enquiry('00000000-0000-4000-8000-0000000003a1', 'on_site', 'visit@example.invalid')));
insert into r values ('call', to_jsonb(pg_temp.enquiry('00000000-0000-4000-8000-0000000003a2', 'phone', 'call@example.invalid')));
insert into r values ('none', to_jsonb(pg_temp.enquiry('00000000-0000-4000-8000-0000000003a3', 'phone', 'none@example.invalid')));
insert into r values ('visit_booking', private.reserve_booking(pg_temp.id('visit'), 'site_visit', pg_temp.slot(12, 10),
  '00000000-0000-4000-8000-0000000003b1') -> 'booking_id');
insert into r values ('call_booking', private.reserve_booking(pg_temp.id('call'), 'phone_consultation', pg_temp.slot(13, 14),
  '00000000-0000-4000-8000-0000000003b2') -> 'booking_id');
select pg_temp.expect(pg_temp.id('visit_booking') is not null and pg_temp.id('call_booking') is not null,
  'test bookings reserved');

-- -------------------------------------------------------------------------------------------
-- anon: no rows, no files, no functions
-- -------------------------------------------------------------------------------------------
set local role anon;
select pg_temp.expect_error('select * from public.enquiry_photos', '42501');
select pg_temp.expect((select count(*) from storage.objects where bucket_id = 'enquiry-photos') = 0,
  'anon lists no photo files');
select pg_temp.expect_error($$insert into storage.objects (bucket_id, name) values ('enquiry-photos', 'x.jpg')$$, '42501');
select pg_temp.expect_error('select private.prepare_state(gen_random_uuid())', '42501');
select pg_temp.expect_error(
  'select private.reserve_photo(gen_random_uuid(), gen_random_uuid(), 10, 1, 1, ''\xffd8ffd9''::bytea)', '42501');
reset role;
select pg_temp.expect((select not public and file_size_limit = 2097152 and allowed_mime_types = array['image/jpeg']
  from storage.buckets where id = 'enquiry-photos'), 'the photo bucket is private, JPEG only, 2 MiB');

-- -------------------------------------------------------------------------------------------
-- The window: a live booking that has not started
-- -------------------------------------------------------------------------------------------
select pg_temp.expect((private.prepare_window(pg_temp.id('visit')) ->> 'open')::boolean, 'open with a live booking');
select pg_temp.expect(private.prepare_window(pg_temp.id('visit')) ->> 'mode' = 'on_site', 'mode of the booking');
select pg_temp.expect(private.prepare_window(pg_temp.id('none')) ->> 'reason' = 'no_booking', 'closed without a booking');
select pg_temp.expect((private.save_prepare(pg_temp.id('none'), '{"budget": "under_10k"}') ->> 'status') = 'closed',
  'no booking: nothing saved');
select private.cancel_booking(pg_temp.id('call_booking'), 'customer', null);
select pg_temp.expect(private.prepare_window(pg_temp.id('call')) ->> 'reason' = 'no_booking', 'closed once cancelled');
select pg_temp.expect((private.reserve_photo(pg_temp.id('call'), gen_random_uuid(), 100, 10, 10, pg_temp.thumb()) ->> 'status') = 'closed',
  'cancelled booking: no photos');
-- A booking whose time has come.
update public.bookings
set starts_at = now() - interval '5 minutes', ends_at = now() + interval '15 minutes',
    blocked = tstzrange(now() - interval '5 minutes', now() + interval '25 minutes'),
    state = 'confirmed', cancelled_at = null, cancelled_by = null
where id = pg_temp.id('call_booking');
select pg_temp.expect(private.prepare_window(pg_temp.id('call')) ->> 'reason' = 'started', 'closed once started');

-- -------------------------------------------------------------------------------------------
-- Answers, notes and consent, each on its own
-- -------------------------------------------------------------------------------------------
select private.save_prepare(pg_temp.id('visit'), '{"budget": "25k_50k"}');
select private.save_prepare(pg_temp.id('visit'), '{"timing": "flexible"}');
select pg_temp.expect((select prepare_details = '{"budget": "25k_50k", "timing": "flexible"}'::jsonb
  and prepare_form_version = 1 and added_after_booking_at is not null
  from public.enquiries where id = pg_temp.id('visit')), 'budget and timing saved separately, same values as v1');
select private.save_prepare(pg_temp.id('visit'), '{"budget": ""}');
select pg_temp.expect((select prepare_details = '{"timing": "flexible"}'::jsonb from public.enquiries
  where id = pg_temp.id('visit')), 'a cleared answer is removed');
select pg_temp.expect_error(format('select private.save_prepare(%L, ''{"budget": "a lot"}'')', pg_temp.id('visit')), '22023');
select pg_temp.expect_error(format('select private.save_prepare(%L, ''{"colour": "red"}'')', pg_temp.id('visit')), '22023');
select pg_temp.expect_error(format('select private.save_prepare(%L, ''{"marketing_opt_in": "yes"}'')', pg_temp.id('visit')), '22023');
select private.save_prepare(pg_temp.id('visit'), '{"access_notes": "Side gate, ring the bell"}');
select pg_temp.expect((select site_details = '{"site_address": "12 Example Road, Dublin 8", "access_notes": "Side gate, ring the bell"}'::jsonb
  from public.enquiries where id = pg_temp.id('visit')), 'access notes kept with the address');
select pg_temp.expect_error(format('select private.save_prepare(%L, %L)', pg_temp.id('visit'),
  jsonb_build_object('access_notes', repeat('x', 501))), '22023');
select private.save_prepare(pg_temp.id('visit'), '{"marketing_opt_in": true}');
select pg_temp.expect((select marketing_opt_in and marketing_opt_in_at is not null from public.enquiries
  where id = pg_temp.id('visit')), 'the same consent record as v1');
select private.save_prepare(pg_temp.id('visit'), '{"marketing_opt_in": false}');
select pg_temp.expect((select not marketing_opt_in and marketing_opt_in_at is null from public.enquiries
  where id = pg_temp.id('visit')), 'consent withdrawn');
select pg_temp.expect((select count(*) from public.enquiry_events where enquiry_id = pg_temp.id('visit')
  and kind = 'prepare_updated') = 6, 'each change is in the history');
-- No staff alert per change.
select pg_temp.expect((select count(*) from public.communications where enquiry_id = pg_temp.id('visit')
  and template like 'staff_%' and template <> 'staff_new_enquiry') = 0, 'no alert per addition');

-- -------------------------------------------------------------------------------------------
-- Photos: idempotent reserve, owner only, limit of 8, removal queues the file
-- -------------------------------------------------------------------------------------------
insert into r values ('p1', private.reserve_photo(pg_temp.id('visit'), '00000000-0000-4000-8000-0000000003c1', 1000, 800, 600, pg_temp.thumb()));
select pg_temp.expect((select value ->> 'status' from r where name = 'p1') = 'reserved', 'reserved');
select pg_temp.expect((select value ->> 'path' from r where name = 'p1')
  ~ ('^enquiries/' || pg_temp.id('visit') || '/[0-9a-f-]{36}\.jpg$'), 'stored under the enquiry');
select pg_temp.expect((private.reserve_photo(pg_temp.id('visit'), '00000000-0000-4000-8000-0000000003c1', 1000, 800, 600, pg_temp.thumb()) ->> 'id')
  = (select value ->> 'id' from r where name = 'p1'), 'a retry gets the same photo');
select pg_temp.expect((private.reserve_photo(pg_temp.id('none'), '00000000-0000-4000-8000-0000000003c1', 1000, 800, 600, pg_temp.thumb()) ->> 'status')
  = 'forbidden', 'another enquiry cannot use the key');
-- Hidden until stored.
select pg_temp.expect(jsonb_array_length(private.prepare_state(pg_temp.id('visit')) -> 'photos') = 0, 'pending photo hidden');
select private.photo_stored(pg_temp.id('visit'), (select (value ->> 'id')::uuid from r where name = 'p1'));
select pg_temp.expect(jsonb_array_length(private.prepare_state(pg_temp.id('visit')) -> 'photos') = 1, 'stored photo shown');
select pg_temp.expect((private.reserve_photo(pg_temp.id('visit'), '00000000-0000-4000-8000-0000000003c1', 1000, 800, 600, pg_temp.thumb()) ->> 'status')
  = 'stored', 'a retry after storing says so');
select pg_temp.expect_error(format('select private.reserve_photo(%L, gen_random_uuid(), 3000000, 800, 600, %L::bytea)',
  pg_temp.id('visit'), '\xffd8ffd9'), '23514');
select pg_temp.expect_error(format('select private.reserve_photo(%L, gen_random_uuid(), 1000, 5000, 600, %L::bytea)',
  pg_temp.id('visit'), '\xffd8ffd9'), '23514');
select private.reserve_photo(pg_temp.id('visit'), gen_random_uuid(), 1000, 800, 600, pg_temp.thumb()) from generate_series(2, 8);
select pg_temp.expect((private.reserve_photo(pg_temp.id('visit'), gen_random_uuid(), 1000, 800, 600, pg_temp.thumb()) ->> 'status')
  = 'limit', 'no ninth photo');

-- Staff read stored photos; a signed-in outsider reads nothing.
insert into auth.users (id, aud, role, email) values
  ('00000000-0000-4000-8000-0000000003d1', 'authenticated', 'authenticated', 'staffp@example.invalid'),
  ('00000000-0000-4000-8000-0000000003d2', 'authenticated', 'authenticated', 'outsiderp@example.invalid');
select private.add_staff('00000000-0000-4000-8000-0000000003d1', 'staffp@example.invalid', 'Staff P', 'staff');
insert into storage.objects (bucket_id, name) values ('enquiry-photos', (select value ->> 'path' from r where name = 'p1'));
set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-0000000003d1');
select pg_temp.expect((select count(*) from public.enquiry_photos where enquiry_id = pg_temp.id('visit')) = 1,
  'staff see the stored photo only');
select pg_temp.expect((select count(*) from storage.objects where bucket_id = 'enquiry-photos'
  and name = (select value ->> 'path' from r where name = 'p1')) = 1, 'staff read the file');
select pg_temp.expect_error('delete from public.enquiry_photos', '42501');
select pg_temp.as_user('00000000-0000-4000-8000-0000000003d2');
select pg_temp.expect((select count(*) from public.enquiry_photos) = 0, 'outsider reads no photos');
select pg_temp.expect((select count(*) from storage.objects where bucket_id = 'enquiry-photos') = 0, 'outsider reads no files');
reset role;

-- The customer removes one: the row goes and its file is queued for the storage API.
select pg_temp.expect((private.remove_photo(pg_temp.id('visit'), (select (value ->> 'id')::uuid from r where name = 'p1')) ->> 'status')
  = 'removed', 'removed');
select pg_temp.expect(exists (select 1 from private.pending_photo_deletions
  where object_path = (select value ->> 'path' from r where name = 'p1')), 'its file is queued');
select pg_temp.expect((private.remove_photo(pg_temp.id('none'), gen_random_uuid()) ->> 'status') = 'closed',
  'no booking: nothing removed');
-- The worker claims the queue with backoff, and clears what the storage API removed.
select pg_temp.expect((select count(*) from private.claim_photo_deletions(100)
  where claim_photo_deletions = (select value ->> 'path' from r where name = 'p1')) = 1, 'claimed');
select pg_temp.expect((select count(*) from private.claim_photo_deletions(100)
  where claim_photo_deletions = (select value ->> 'path' from r where name = 'p1')) = 0, 'not claimed twice at once');
select private.photo_deletion_done(array[(select value ->> 'path' from r where name = 'p1')]);
select pg_temp.expect(not exists (select 1 from private.pending_photo_deletions
  where object_path = (select value ->> 'path' from r where name = 'p1')), 'done');

-- A reserved row never stored is purged after an hour, and its file (if any) queued.
update public.enquiry_photos set created_at = now() - interval '2 hours'
where enquiry_id = pg_temp.id('visit') and uploaded_at is null
  and id = (select id from public.enquiry_photos where enquiry_id = pg_temp.id('visit') and uploaded_at is null limit 1);
select pg_temp.expect(private.purge_stale_photos() >= 1, 'stale reservation purged');

-- -------------------------------------------------------------------------------------------
-- Deleting the enquiry (data request or retention) removes rows and queues every file
-- -------------------------------------------------------------------------------------------
create temp table paths as select object_path from public.enquiry_photos where enquiry_id = pg_temp.id('visit');
select pg_temp.expect((select count(*) from paths) >= 6, 'photos to delete');
select private.delete_enquiry_data(pg_temp.id('visit'), 'retention', null);
select pg_temp.expect(not exists (select 1 from public.enquiry_photos where enquiry_id = pg_temp.id('visit')), 'rows gone');
select pg_temp.expect((select count(*) from private.pending_photo_deletions where object_path in (select object_path from paths))
  = (select count(*) from paths), 'every file queued for removal');

rollback;
