-- The Ads page by campaign: the "Type test 1" backfill, attach_tagged_ads (idempotent, nothing
-- without tagged ads), the running flag (admins only) and the anon list. Always rolled back.
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

-- The live backfill: every live ad tagged type-test-1 has a creative whose slug is its link's
-- utm_content, in the campaign "Type test 1" whose source and medium match the links.
select pg_temp.expect(not exists (
  select 1 from public.ads a
  join lateral (select link_url from public.ad_versions where ad_id = a.id order by version desc limit 1) v on true
  left join public.campaign_creatives c on c.id = a.campaign_creative_id
  left join public.campaigns k on k.id = c.campaign_id
  where a.status <> 'archived' and v.link_url ~ '[?&]utm_campaign=type-test-1([&#]|$)'
    and (c.id is null or k.slug <> 'type-test-1'
         or v.link_url !~ ('[?&]utm_content=' || c.slug || '([&#]|$)')
         or v.link_url !~ ('[?&]utm_medium=' || k.utm_medium || '([&#]|$)'))),
  'each live type-test-1 ad is linked to its own creative, and the campaign agrees with the links');

-- attach_tagged_ads: nothing without tagged ads.
select pg_temp.expect(private.attach_tagged_ads('zz-no-such-campaign', 'Nothing') = 0, 'nothing to attach');
select pg_temp.expect(not exists (select 1 from public.campaigns where slug = 'zz-no-such-campaign'),
  'no empty campaign made');

-- Two live ads and an archived one tagged zz-test; run twice.
insert into public.ads (id, name, status) values
  ('00000000-0000-4000-8000-0000000ad001', 'First test ad', 'approved'),
  ('00000000-0000-4000-8000-0000000ad002', 'Second test ad', 'new'),
  ('00000000-0000-4000-8000-0000000ad003', 'Archived test ad', 'archived');
insert into public.ad_versions (ad_id, version, caption, link_url) values
  ('00000000-0000-4000-8000-0000000ad001', 1, 'x',
   'https://book.q3interiors.ie/?utm_source=instagram&utm_medium=paid&utm_campaign=zz-test&utm_content=first-one#/'),
  ('00000000-0000-4000-8000-0000000ad002', 1, 'x',
   'https://book.q3interiors.ie/?utm_source=instagram&utm_medium=paid&utm_campaign=zz-test&utm_content=second#/'),
  ('00000000-0000-4000-8000-0000000ad003', 1, 'x',
   'https://book.q3interiors.ie/?utm_source=instagram&utm_medium=paid&utm_campaign=zz-test&utm_content=old#/');
select pg_temp.expect(private.attach_tagged_ads('zz-test', 'ZZ test') = 2, 'two ads attached');
select pg_temp.expect(private.attach_tagged_ads('zz-test', 'ZZ test') = 0, 'a second run changes nothing');
select pg_temp.expect((select count(*) = 1 from public.campaigns
  where slug = 'zz-test' and utm_medium = 'paid' and utm_source = 'instagram' and link_used_at is not null),
  'one campaign, medium from the links, links marked as out');
select pg_temp.expect((select array_agg(c.slug order by c.slug) from public.campaign_creatives c
  join public.campaigns k on k.id = c.campaign_id where k.slug = 'zz-test') = array['first-one', 'second'],
  'one creative per live ad, slug from utm_content');
select pg_temp.expect((select campaign_creative_id is null from public.ads where id = '00000000-0000-4000-8000-0000000ad003'),
  'archived ads are left alone');
select pg_temp.expect((select bool_and(not running) from public.campaign_creatives c
  join public.campaigns k on k.id = c.campaign_id where k.slug = 'zz-test'), 'not running until ticked');

-- Running: admins tick it; staff read it but cannot change it.
insert into auth.users (id, aud, role, email) values
  ('00000000-0000-4000-8000-0000000ad0a1', 'authenticated', 'authenticated', 'adsadmin@example.invalid'),
  ('00000000-0000-4000-8000-0000000ad0b1', 'authenticated', 'authenticated', 'adsstaff@example.invalid');
select private.add_staff('00000000-0000-4000-8000-0000000ad0a1', 'adsadmin@example.invalid', 'Ads Admin', 'admin');
select private.add_staff('00000000-0000-4000-8000-0000000ad0b1', 'adsstaff@example.invalid', 'Ads Staff', 'staff');
set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-0000000ad0b1');
select pg_temp.expect((select count(*) = 2 from public.campaign_creatives where slug in ('first-one', 'second')),
  'staff read the creatives');
update public.campaign_creatives set running = true where slug = 'first-one';
select pg_temp.as_user('00000000-0000-4000-8000-0000000ad0a1');
select pg_temp.expect((select not running from public.campaign_creatives where slug = 'first-one'),
  'staff cannot tick running');
update public.campaign_creatives set running = true where slug = 'first-one';
select pg_temp.expect((select running from public.campaign_creatives where slug = 'first-one'),
  'an admin ticks running');
reset role;
set local role anon;
select pg_temp.expect_error('select running from public.campaign_creatives', '42501');
select pg_temp.expect_error('select private.attach_tagged_ads(''x'', ''x'')', '42501');
reset role;

select pg_temp.expect(
  (select array_agg(p.proname::text order by p.proname)
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'private') and has_function_privilege('anon', p.oid, 'execute'))
  = array['public_appointment_types', 'public_business_details', 'public_wording',
          'record_visit', 'submit_enquiry_with_access'],
  'anon may run only the five public functions');

rollback;
