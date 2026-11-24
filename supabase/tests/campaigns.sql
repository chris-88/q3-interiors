-- Slice 5 campaigns, creatives and spend: access and the slug guard. Always rolled back.
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
grant all on r to authenticated;

insert into auth.users (id, aud, role, email) values
  ('00000000-0000-4000-8000-0000000008b1', 'authenticated', 'authenticated', 'staff8@example.invalid'),
  ('00000000-0000-4000-8000-0000000008c1', 'authenticated', 'authenticated', 'off8@example.invalid');
select private.add_staff('00000000-0000-4000-8000-0000000008b1', 'staff8@example.invalid', 'Staff Eight', 'staff');
select private.add_staff('00000000-0000-4000-8000-0000000008c1', 'off8@example.invalid', 'Off Eight', 'admin');
select private.set_staff_active('00000000-0000-4000-8000-0000000008c1', false);

-- admin creates a campaign, a creative and spend.
set local role authenticated;
select pg_temp.as_user(public.bookable_staff()::text);
insert into public.campaigns (name, slug) values ('Test Spring Kitchens', 'test-spring-kitchens');
insert into r select 'c', id::text from public.campaigns where slug = 'test-spring-kitchens';
insert into public.campaign_creatives (campaign_id, label, slug) select value::uuid, 'Reel 1', 'reel-1' from r where name = 'c';
insert into public.campaign_spend (campaign_id, spent_on, amount_cents, note) select value::uuid, current_date, 12550, 'Week 1' from r where name = 'c';
insert into public.campaign_spend (campaign_id, spent_on, amount_cents) select value::uuid, current_date - 40, 9999 from r where name = 'c';
select pg_temp.expect_error($$insert into public.campaigns (name, slug) values ('Dup', 'test-spring-kitchens')$$, '23505');
select pg_temp.expect_error($$insert into public.campaigns (name, slug) values ('Bad', 'Spring Kitchens!')$$, '23514');
select pg_temp.expect_error($$insert into public.campaigns (name, slug, landing_route) values ('Bad', 'bad-route', '/staff')$$, '23514');
select pg_temp.expect_error(format('insert into public.campaign_spend (campaign_id, spent_on, amount_cents) values (%L, current_date, 0)',
  (select value from r where name = 'c')), '23514');
select pg_temp.expect((select spend_cents = 12550 and spend_entries = 1 from public.campaign_costs(current_date - 7, current_date)
  where campaign = 'test-spring-kitchens'), 'spend in range only');
select pg_temp.expect_error('update public.campaigns set link_used_at = now()', '42501');
-- Before any link is out, the slug may change; after, it may not.
update public.campaigns set slug = 'test-spring-kitchen' where slug = 'test-spring-kitchens';
select public.mark_campaign_link_used((select value::uuid from r where name = 'c'));
select pg_temp.expect_error('update public.campaigns set slug = ''test-other'' where slug = ''test-spring-kitchen''', '22023');
select pg_temp.expect_error('update public.campaign_creatives set slug = ''reel-2'' where slug = ''reel-1''', '22023');
update public.campaigns set name = 'Test Spring Kitchens 2026', archived_at = now() where slug = 'test-spring-kitchen';
delete from public.campaigns where slug = 'test-spring-kitchen';
reset role;
select pg_temp.expect(exists (select 1 from public.campaigns where slug = 'test-spring-kitchen'), 'a campaign whose link is out cannot be deleted');

-- staff: read campaigns and creatives, never spend, never write.
set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-0000000008b1');
select pg_temp.expect((select count(*) from public.campaigns where slug = 'test-spring-kitchen') = 1, 'staff read campaigns');
select pg_temp.expect((select count(*) from public.campaign_creatives where slug = 'reel-1') = 1, 'staff read creatives');
select pg_temp.expect((select count(*) from public.campaign_spend) = 0, 'staff read no spend');
select pg_temp.expect_error('select * from public.campaign_costs(current_date, current_date)', '42501');
select pg_temp.expect_error($$insert into public.campaigns (name, slug) values ('X', 'x-staff')$$, '42501');
select pg_temp.expect_error(format('insert into public.campaign_spend (campaign_id, spent_on, amount_cents) values (%L, current_date, 100)',
  (select value from r where name = 'c')), '42501');
select pg_temp.expect_error(format('select public.mark_campaign_link_used(%L)', (select value from r where name = 'c')), '42501');
update public.campaigns set name = 'Renamed by staff';
reset role;
select pg_temp.expect(not exists (select 1 from public.campaigns where name = 'Renamed by staff'), 'staff cannot rename');

-- deactivated admin: nothing.
set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-0000000008c1');
select pg_temp.expect((select count(*) from public.campaigns) = 0, 'deactivated read no campaigns');
select pg_temp.expect_error('select * from public.campaign_costs(current_date, current_date)', '42501');
reset role;

-- anon: nothing.
set local role anon;
select pg_temp.expect_error('select * from public.campaigns', '42501');
select pg_temp.expect_error('select * from public.campaign_spend', '42501');
reset role;

-- Enquiries that already carry a slug block a rename even without the link builder.
insert into public.campaigns (name, slug) values ('Seen', 'test-seen');
insert into public.enquiries (id, reference, idempotency_key, form_id, form_version, answers)
select gen_random_uuid(), 'Q3-TSTCMP', gen_random_uuid(), 'enquiry', 1, '{}'::jsonb;
insert into public.enquiry_attribution (enquiry_id, tracking, utm_campaign)
select id, 'tagged', 'test-seen' from public.enquiries where reference = 'Q3-TSTCMP';
select pg_temp.expect_error('update public.campaigns set slug = ''test-seen-2'' where slug = ''test-seen''', '22023');

rollback;
