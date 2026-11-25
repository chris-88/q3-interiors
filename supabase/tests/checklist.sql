-- Slice 5 go-live checklist, ticks, test-calendar flag and limits. Always rolled back.
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
grant all on r to authenticated;

insert into auth.users (id, aud, role, email) values
  ('00000000-0000-4000-8000-0000000009b1', 'authenticated', 'authenticated', 'staff9@example.invalid');
select private.add_staff('00000000-0000-4000-8000-0000000009b1', 'staff9@example.invalid', 'Staff Nine', 'staff');

-- anon and staff: no checklist, no ticks, no limits.
set local role anon;
select pg_temp.expect_error('select public.go_live_checklist()', '42501');
select pg_temp.expect_error('select * from public.setup_ticks', '42501');
reset role;
set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-0000000009b1');
select pg_temp.expect_error('select public.go_live_checklist()', '42501');
select pg_temp.expect_error('select public.mark_test_calendar()', '42501');
select pg_temp.expect_error($$insert into public.setup_ticks (key) values ('phone_check')$$, '42501');
update public.booking_settings set enquiry_limit_per_hour = 99;
reset role;
select pg_temp.expect((select enquiry_limit_per_hour <> 99 from public.booking_settings), 'staff cannot change limits');

-- admin: the checklist reflects the data.
set local role authenticated;
select pg_temp.as_user(public.bookable_staff()::text);
update public.business_details set legal_name = null, privacy_reviewed_at = null;
insert into r select 'c1', public.go_live_checklist();
reset role;
select pg_temp.expect((select (value -> 'business_missing') ? 'legal name' from r where name = 'c1'), 'missing legal name listed');
select pg_temp.expect((select (value ->> 'form_version')::int >= 1 from r where name = 'c1'), 'form version reported');
select pg_temp.expect((select value ->> 'bookable_name' is not null from r where name = 'c1'), 'bookable person named');
set local role authenticated;
select pg_temp.as_user(public.bookable_staff()::text);
update public.business_details set legal_name = 'A Ltd', postal_address = '1 Road, Dublin', contact_phone = '01 555 0100',
  contact_email = 'a@example.invalid', service_area = 'Dublin', privacy_contact = 'p@example.invalid';
insert into public.setup_ticks (key, ticked_by_name) values ('phone_check', 'Admin') on conflict (key) do nothing;
select pg_temp.expect_error($$insert into public.setup_ticks (key) values ('anything_else')$$, '23514');
update public.booking_settings set enquiry_limit_per_hour = 10, booking_write_limit_per_hour = 30, booking_read_limit_per_hour = 400;
select pg_temp.expect_error('update public.booking_settings set enquiry_limit_per_hour = 0', '23514');
select pg_temp.expect_error('update public.booking_settings set booking_read_limit_per_hour = 10', '23514');
insert into r select 'c2', public.go_live_checklist();
reset role;
select pg_temp.expect((select jsonb_array_length(value -> 'business_missing') = 0 and (value ->> 'privacy_reviewable')::boolean
  and value -> 'ticks' ? 'phone_check' from r where name = 'c2'), 'details complete, tick recorded');
select pg_temp.expect((select enquiry_limit_per_hour = 10 from public.booking_settings), 'admin changes limits');

-- The test-calendar flag follows the connection of whoever takes bookings.
insert into public.calendar_connections (staff_user_id, status, google_email)
values (public.bookable_staff(), 'connected', 'test-account@example.invalid')
on conflict (staff_user_id) do update set status = 'connected', google_email = 'test-account@example.invalid';
set local role authenticated;
select pg_temp.as_user(public.bookable_staff()::text);
select pg_temp.expect(public.mark_test_calendar() = 'test-account@example.invalid', 'flag set to the connected account');
select pg_temp.expect((public.go_live_checklist() ->> 'test_calendar_email') = 'test-account@example.invalid', 'flag reported');
select pg_temp.expect(public.mark_test_calendar(true) is null, 'flag cleared');
delete from public.setup_ticks where key = 'phone_check';
reset role;
select pg_temp.expect(not exists (select 1 from public.setup_ticks where key = 'phone_check'), 'admin unticks');

rollback;
