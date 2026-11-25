-- Slice 6 part B: requests, withdrawal, approval, archiving, new versions. Always rolled back.
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
create temp table r (name text primary key, value text);
grant all on r to authenticated, service_role;

insert into auth.users (id, aud, role, email) values
  ('00000000-0000-4000-8000-00000000b6a1', 'authenticated', 'authenticated', 'adminb6@example.invalid'),
  ('00000000-0000-4000-8000-00000000b6b1', 'authenticated', 'authenticated', 'staffb6@example.invalid'),
  ('00000000-0000-4000-8000-00000000b6b2', 'authenticated', 'authenticated', 'staffb6two@example.invalid'),
  ('00000000-0000-4000-8000-00000000b6c1', 'authenticated', 'authenticated', 'offb6@example.invalid'),
  ('00000000-0000-4000-8000-00000000b6d1', 'authenticated', 'authenticated', 'outsiderb6@example.invalid');
select private.add_staff('00000000-0000-4000-8000-00000000b6a1', 'adminb6@example.invalid', 'Admin B6', 'admin');
select private.add_staff('00000000-0000-4000-8000-00000000b6b1', 'staffb6@example.invalid', 'Staff B6', 'staff');
select private.add_staff('00000000-0000-4000-8000-00000000b6b2', 'staffb6two@example.invalid', 'Staff B6 Two', 'staff');
select private.add_staff('00000000-0000-4000-8000-00000000b6c1', 'offb6@example.invalid', 'Off B6', 'admin');
select private.set_staff_active('00000000-0000-4000-8000-00000000b6c1', false);

-- An ad with version 1, as the publish command makes it.
set local role service_role;
insert into public.ads (id, name) values ('00000000-0000-4000-8000-00000000b601', 'TEST review ad');
insert into public.ad_versions (id, ad_id, version, caption)
values ('00000000-0000-4000-8000-00000000b611', '00000000-0000-4000-8000-00000000b601', 1, 'Caption one');
select public.record_ad_version('00000000-0000-4000-8000-00000000b611', '{}', 'test');
reset role;

-- anon and a signed-in outsider: nothing.
set local role anon;
select pg_temp.expect_error('select * from public.ad_requests', '42501');
select pg_temp.expect_error('select * from public.ad_events', '42501');
select pg_temp.expect_error($$select public.request_ad_change('00000000-0000-4000-8000-00000000b601', 'Make it bigger')$$, '42501');
select pg_temp.expect_error($$select public.approve_ad('00000000-0000-4000-8000-00000000b601', 1)$$, '42501');
select pg_temp.expect_error($$select public.record_ad_version('00000000-0000-4000-8000-00000000b611')$$, '42501');
reset role;
set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-00000000b6d1');
select pg_temp.expect_error($$select public.request_ad_change('00000000-0000-4000-8000-00000000b601', 'Make it bigger')$$, '42501');
select pg_temp.expect_error($$select public.record_ad_version('00000000-0000-4000-8000-00000000b611')$$, '42501');
reset role;

-- staff: ask for a change; the ad moves to changes requested.
set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-00000000b6b1');
insert into r select 'req1', public.request_ad_change('00000000-0000-4000-8000-00000000b601', '  Bigger headline on the feed size  ', 'portrait');
select pg_temp.expect_error($$select public.request_ad_change('00000000-0000-4000-8000-00000000b601', 'x')$$, '22023');
select pg_temp.expect_error($$select public.request_ad_change('00000000-0000-4000-8000-00000000b601', 'Fine words', 'banner')$$, '22023');
select pg_temp.expect_error(format('select public.request_ad_change(%L, %L)', '00000000-0000-4000-8000-00000000b601', repeat('x', 1001)), '22023');
-- Staff cannot approve, archive, or write the tables directly.
select pg_temp.expect_error($$select public.approve_ad('00000000-0000-4000-8000-00000000b601', 1, true)$$, '42501');
select pg_temp.expect_error($$select public.archive_ad('00000000-0000-4000-8000-00000000b601')$$, '42501');
select pg_temp.expect_error($$insert into public.ad_requests (ad_id, version_id, body, created_by_name)
  values ('00000000-0000-4000-8000-00000000b601', '00000000-0000-4000-8000-00000000b611', 'direct', 'me')$$, '42501');
select pg_temp.expect_error($$update public.ad_requests set state = 'done', done_in_version = 1$$, '42501');
select pg_temp.expect_error($$update public.ads set status = 'approved'$$, '42501');
select pg_temp.expect_error($$insert into public.ad_events (ad_id, kind) values ('00000000-0000-4000-8000-00000000b601', 'approved')$$, '42501');
select pg_temp.expect((select count(*) from public.ad_requests where ad_id = '00000000-0000-4000-8000-00000000b601') = 1, 'staff read requests');
reset role;
select pg_temp.expect((select status = 'changes_requested' from public.ads where id = '00000000-0000-4000-8000-00000000b601'), 'changes requested');
select pg_temp.expect((select body = 'Bigger headline on the feed size' and size = 'portrait' and created_by_name = 'Staff B6'
  from public.ad_requests where id = (select value::uuid from r where name = 'req1')), 'request saved, trimmed, with who asked');

-- Only the person who asked can withdraw it.
set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-00000000b6b2');
select pg_temp.expect_error(format('select public.withdraw_ad_request(%L)', (select value from r where name = 'req1')), '42501');
insert into r select 'req2', public.request_ad_change('00000000-0000-4000-8000-00000000b601', 'Try the black background', 'both');
select pg_temp.as_user('00000000-0000-4000-8000-00000000b6b1');
select public.withdraw_ad_request((select value::uuid from r where name = 'req1'));
select pg_temp.expect_error(format('select public.withdraw_ad_request(%L)', (select value from r where name = 'req1')), '22023');
reset role;
select pg_temp.expect((select state = 'withdrawn' from public.ad_requests where id = (select value::uuid from r where name = 'req1')), 'withdrawn');
select pg_temp.expect((select status = 'changes_requested' from public.ads where id = '00000000-0000-4000-8000-00000000b601'),
  'still changes requested while another request is open');

-- Admin: approving with an open request needs confirmation; a switched-off admin cannot.
set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-00000000b6c1');
select pg_temp.expect_error($$select public.approve_ad('00000000-0000-4000-8000-00000000b601', 1, true)$$, '42501');
select pg_temp.expect_error($$select public.request_ad_change('00000000-0000-4000-8000-00000000b601', 'From a switched-off account')$$, '42501');
select pg_temp.as_user('00000000-0000-4000-8000-00000000b6a1');
select pg_temp.expect_error($$select public.approve_ad('00000000-0000-4000-8000-00000000b601', 1)$$, '22023');
select pg_temp.expect_error($$select public.approve_ad('00000000-0000-4000-8000-00000000b601', 2, true)$$, '22023');
select public.approve_ad('00000000-0000-4000-8000-00000000b601', 1, true);
reset role;
select pg_temp.expect((select status = 'approved' from public.ads where id = '00000000-0000-4000-8000-00000000b601'), 'approved');
select pg_temp.expect((select approved_by_name = 'Admin B6' and approved_at is not null from public.ad_versions
  where id = '00000000-0000-4000-8000-00000000b611'), 'who and when recorded');

-- A new version (the publish command) marks the open request done and resets the ad to new.
set local role service_role;
insert into public.ad_versions (id, ad_id, version, caption)
values ('00000000-0000-4000-8000-00000000b612', '00000000-0000-4000-8000-00000000b601', 2, 'Caption two');
select pg_temp.expect_error(format('select public.record_ad_version(%L, array[%L]::uuid[])',
  '00000000-0000-4000-8000-00000000b612', (select value from r where name = 'req1')), '22023');
select pg_temp.expect(public.record_ad_version('00000000-0000-4000-8000-00000000b612',
  array[(select value::uuid from r where name = 'req2')], 'Ad studio') = 1, 'one request done');
reset role;
select pg_temp.expect((select status = 'new' from public.ads where id = '00000000-0000-4000-8000-00000000b601'), 'new version resets to new');
select pg_temp.expect((select state = 'done' and done_in_version = 2
  and version_id = '00000000-0000-4000-8000-00000000b611' from public.ad_requests
  where id = (select value::uuid from r where name = 'req2')), 'done in version 2, still attached to version 1');

-- New requests attach to the current version; archive and bring back.
set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-00000000b6b1');
insert into r select 'req3', public.request_ad_change('00000000-0000-4000-8000-00000000b601', 'Smaller logo please');
select pg_temp.as_user('00000000-0000-4000-8000-00000000b6a1');
select public.archive_ad('00000000-0000-4000-8000-00000000b601');
select pg_temp.as_user('00000000-0000-4000-8000-00000000b6b1');
select pg_temp.expect_error($$select public.request_ad_change('00000000-0000-4000-8000-00000000b601', 'On an archived ad')$$, '22023');
select pg_temp.as_user('00000000-0000-4000-8000-00000000b6a1');
select public.archive_ad('00000000-0000-4000-8000-00000000b601', false);
reset role;
select pg_temp.expect((select version_id = '00000000-0000-4000-8000-00000000b612' from public.ad_requests
  where id = (select value::uuid from r where name = 'req3')), 'request on the current version');
select pg_temp.expect((select status = 'changes_requested' from public.ads where id = '00000000-0000-4000-8000-00000000b601'),
  'unarchived back to changes requested (open request)');
select pg_temp.expect((select array_agg(kind order by id) from public.ad_events where ad_id = '00000000-0000-4000-8000-00000000b601')
  = array['published','requested','requested','withdrawn','approved','published','request_done','requested','archived','unarchived'],
  'every step audited');

rollback;
