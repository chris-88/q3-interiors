-- Slice 6 part A: who reads ads and their files. One transaction, always rolled back.
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

insert into auth.users (id, aud, role, email) values
  ('00000000-0000-4000-8000-00000000a6b1', 'authenticated', 'authenticated', 'staffa6@example.invalid'),
  ('00000000-0000-4000-8000-00000000a6c1', 'authenticated', 'authenticated', 'offa6@example.invalid'),
  ('00000000-0000-4000-8000-00000000a6d1', 'authenticated', 'authenticated', 'outsidera6@example.invalid');
select private.add_staff('00000000-0000-4000-8000-00000000a6b1', 'staffa6@example.invalid', 'Staff A6', 'staff');
select private.add_staff('00000000-0000-4000-8000-00000000a6c1', 'offa6@example.invalid', 'Off A6', 'staff');
select private.set_staff_active('00000000-0000-4000-8000-00000000a6c1', false);

-- What the publish command writes (as the service role).
set local role service_role;
insert into public.ads (id, name, created_by_name) values ('00000000-0000-4000-8000-00000000a601', 'TEST ad', 'test');
insert into public.ad_versions (id, ad_id, version, caption, headline, button_label)
values ('00000000-0000-4000-8000-00000000a602', '00000000-0000-4000-8000-00000000a601', 1, 'Caption', 'Headline', 'Learn more');
insert into public.ad_variants (version_id, size, width, height, html_path, export_path)
values ('00000000-0000-4000-8000-00000000a602', 'portrait', 1440, 1800, 'ad/v1/portrait.html', 'ad/v1/portrait.png');
reset role;
select pg_temp.expect((select status = 'new' from public.ads where id = '00000000-0000-4000-8000-00000000a601'), 'new by default');
select pg_temp.expect_error($$insert into public.ad_variants (version_id, size, width, height, html_path, export_path)
  values ('00000000-0000-4000-8000-00000000a602', 'banner', 1440, 1800, 'x.html', 'x.png')$$, '23514');
select pg_temp.expect_error($$insert into public.ad_variants (version_id, size, width, height, html_path, export_path)
  values ('00000000-0000-4000-8000-00000000a602', 'vertical', 1440, 2560, 'https://evil.example/x.html', 'x.png')$$, '23514');
select pg_temp.expect_error($$insert into public.ad_versions (ad_id, version, caption, headline)
  values ('00000000-0000-4000-8000-00000000a601', 2, 'c', repeat('x', 41))$$, '23514');
insert into storage.objects (bucket_id, name) values ('ads', 'ad/v1/portrait.html');
-- Animated variants carry a video, a loop length and a poster; stills carry neither.
set local role service_role;
insert into public.ad_variants (version_id, size, width, height, html_path, export_path, export_type, duration_ms, poster_path)
values ('00000000-0000-4000-8000-00000000a602', 'vertical', 1440, 2560, 'ad/v1/vertical.html', 'ad/v1/vertical.mp4', 'video', 6000, 'ad/v1/vertical.png');
reset role;
select pg_temp.expect((select export_type = 'image' from public.ad_variants where size = 'portrait'
  and version_id = '00000000-0000-4000-8000-00000000a602'), 'stills default to image');
select pg_temp.expect_error($$insert into public.ad_variants (version_id, size, width, height, html_path, export_path, export_type)
  values ('00000000-0000-4000-8000-00000000a602', 'square', 1440, 1440, 'a/s.html', 'a/s.mp4', 'video')$$, '23514');
select pg_temp.expect_error($$insert into public.ad_variants (version_id, size, width, height, html_path, export_path, duration_ms)
  values ('00000000-0000-4000-8000-00000000a602', 'square', 1440, 1440, 'a/s.html', 'a/s.png', 6000)$$, '23514');
select pg_temp.expect_error($$insert into public.ad_variants (version_id, size, width, height, html_path, export_path, export_type, duration_ms, poster_path)
  values ('00000000-0000-4000-8000-00000000a602', 'square', 1440, 1440, 'a/s.html', 'a/s.mp4', 'video', 60000, 'a/s.png')$$, '23514');

-- The bucket is private.
select pg_temp.expect((select not public from storage.buckets where id = 'ads'), 'ads bucket is private');

-- anon: nothing.
set local role anon;
select pg_temp.expect_error('select * from public.ads', '42501');
select pg_temp.expect_error('select * from public.ad_versions', '42501');
select pg_temp.expect_error('select * from public.ad_variants', '42501');
select pg_temp.expect((select count(*) from storage.objects where bucket_id = 'ads') = 0, 'anon reads no ad files');
reset role;

-- a signed-in outsider: nothing.
set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-00000000a6d1');
select pg_temp.expect((select count(*) from public.ads) = 0, 'outsider reads no ads');
select pg_temp.expect((select count(*) from storage.objects where bucket_id = 'ads') = 0, 'outsider reads no ad files');
reset role;

-- staff: read everything, write nothing.
set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-00000000a6b1');
select pg_temp.expect((select count(*) from public.ads where name = 'TEST ad') = 1, 'staff read ads');
select pg_temp.expect((select count(*) from public.ad_variants where size = 'portrait'
  and version_id = '00000000-0000-4000-8000-00000000a602') = 1, 'staff read variants');
select pg_temp.expect((select count(*) from storage.objects where bucket_id = 'ads' and name = 'ad/v1/portrait.html') = 1,
  'staff read ad files');
select pg_temp.expect_error($$insert into public.ads (name) values ('by staff')$$, '42501');
select pg_temp.expect_error($$update public.ads set status = 'approved'$$, '42501');
select pg_temp.expect_error($$delete from public.ad_versions$$, '42501');
reset role;

-- deactivated: nothing.
set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-00000000a6c1');
select pg_temp.expect((select count(*) from public.ads) = 0, 'deactivated read no ads');
select pg_temp.expect((select count(*) from storage.objects where bucket_id = 'ads') = 0, 'deactivated read no ad files');
reset role;

rollback;
