-- Slice 5 roles and staff accounts, against the real database, in one transaction that is always
-- rolled back. Paths: anon, a signed-in non-staff user, staff, admin, a deactivated person.
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

-- People: the existing admin (who takes bookings), a second admin, a staff member, an outsider.
insert into auth.users (id, aud, role, email) values
  ('00000000-0000-4000-8000-0000000005a1', 'authenticated', 'authenticated', 'admin2@example.invalid'),
  ('00000000-0000-4000-8000-0000000005b1', 'authenticated', 'authenticated', 'dad@example.invalid'),
  ('00000000-0000-4000-8000-0000000005c1', 'authenticated', 'authenticated', 'outsider5@example.invalid');
select private.add_staff('00000000-0000-4000-8000-0000000005a1', 'Admin2@Example.invalid ', ' Second Admin ', 'admin');
select private.add_staff('00000000-0000-4000-8000-0000000005b1', 'dad@example.invalid', 'Dad', 'staff');
select pg_temp.expect((select email = 'admin2@example.invalid' and display_name = 'Second Admin'
  from public.staff where user_id = '00000000-0000-4000-8000-0000000005a1'), 'email lower-cased, name trimmed');
select pg_temp.expect_error($$select private.add_staff('00000000-0000-4000-8000-0000000005c1', 'DAD@example.invalid', 'Copy', 'staff')$$, '23505');
select pg_temp.expect_error($$select private.add_staff('00000000-0000-4000-8000-0000000005c1', 'not-an-email', 'X', 'staff')$$, '23514');
select pg_temp.expect_error($$select private.add_staff('00000000-0000-4000-8000-0000000005c1', 'x@example.invalid', 'X', 'owner')$$, '23514');

create temp table r (name text primary key, value text);
grant all on r to authenticated;
insert into r values ('owner', public.bookable_staff()::text);
insert into r select 'enquiry', id::text from public.enquiries order by submitted_at limit 1;

-- -------------------------------------------------------------------------------------------
-- anon: nothing new is reachable
-- -------------------------------------------------------------------------------------------
set local role anon;
select pg_temp.expect_error('select public.set_bookable_staff(null)', '42501');
select pg_temp.expect_error('select public.is_admin()', '42501');
select pg_temp.expect_error('select private.active_staff_by_email(''x'')', '42501');
reset role;

-- -------------------------------------------------------------------------------------------
-- staff (not admin)
-- -------------------------------------------------------------------------------------------
set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-0000000005b1');
select pg_temp.expect(public.is_staff() and not public.is_admin(), 'staff is staff, not admin');
select pg_temp.expect((select count(*) from public.enquiries) >= 1, 'staff read enquiries');
select pg_temp.expect((select count(*) from public.staff) >= 3, 'staff see the team');
-- Admin-only settings: RLS turns the update into a no-op for staff.
update public.booking_settings set change_cutoff_minutes = 999, retention_months = 1;
update public.appointment_types set duration_minutes = 7;
reset role;
select pg_temp.expect((select change_cutoff_minutes <> 999 and retention_months is distinct from 1
  from public.booking_settings), 'staff cannot change booking settings or retention');
select pg_temp.expect(not exists (select 1 from public.appointment_types where duration_minutes = 7),
  'staff cannot change appointment types');
-- Their own availability: yes; someone else's: no.
insert into public.staff_availability (staff_user_id, working_hours, min_notice_minutes, horizon_days, daily_visit_limit)
values ('00000000-0000-4000-8000-0000000005b1', '{}', 60, 14, 2);
set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-0000000005b1');
update public.staff_availability set horizon_days = 30 where staff_user_id = '00000000-0000-4000-8000-0000000005b1';
update public.staff_availability set horizon_days = 99 where staff_user_id <> '00000000-0000-4000-8000-0000000005b1';
select pg_temp.expect_error('select public.set_bookable_staff(''00000000-0000-4000-8000-0000000005b1'')', '42501');
select pg_temp.expect_error(format('select public.delete_enquiry(%L, ''x'')', (select value from r where name = 'enquiry')), '42501');
select pg_temp.expect_error('select public.retention_preview(12)', '42501');
-- Staff still record outcomes and statuses (checked fully in changes.sql); here only access.
select pg_temp.expect_error(format('select public.set_enquiry_status(%L, ''unsuitable'', '''')',
  (select value from r where name = 'enquiry')), '22023');
reset role;
select pg_temp.expect((select horizon_days = 30 from public.staff_availability
  where staff_user_id = '00000000-0000-4000-8000-0000000005b1'), 'staff edit their own availability');
select pg_temp.expect(not exists (select 1 from public.staff_availability where horizon_days = 99),
  'staff cannot edit someone else''s availability');

-- -------------------------------------------------------------------------------------------
-- admin
-- -------------------------------------------------------------------------------------------
set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-0000000005a1');
select pg_temp.expect(public.is_admin(), 'admin is admin');
update public.booking_settings set change_cutoff_minutes = 180;
select pg_temp.expect(public.retention_preview(12) >= 0, 'admin previews retention');
-- Who takes bookings moves to Dad; his hours are kept (he already had a row).
select public.set_bookable_staff('00000000-0000-4000-8000-0000000005b1');
select pg_temp.expect(public.bookable_staff() = '00000000-0000-4000-8000-0000000005b1', 'bookings go to Dad');
select pg_temp.expect_error('select public.set_bookable_staff(''00000000-0000-4000-8000-0000000005c1'')', '22023');
reset role;
select pg_temp.expect((select change_cutoff_minutes = 180 from public.booking_settings), 'admin changes settings');
select pg_temp.expect((select horizon_days = 30 from public.staff_availability
  where staff_user_id = '00000000-0000-4000-8000-0000000005b1'), 'existing hours kept on switch');
-- Existing bookings keep their person.
select pg_temp.expect(not exists (select 1 from public.bookings where staff_user_id = '00000000-0000-4000-8000-0000000005b1'),
  'no booking moved to the new person');
-- Switching to the second admin (no hours yet) copies Dad's hours.
set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-0000000005a1');
select public.set_bookable_staff('00000000-0000-4000-8000-0000000005a1');
reset role;
select pg_temp.expect((select horizon_days = 30 from public.staff_availability
  where staff_user_id = '00000000-0000-4000-8000-0000000005a1'), 'new person starts from the previous hours');

-- -------------------------------------------------------------------------------------------
-- Guards on deactivation and role changes
-- -------------------------------------------------------------------------------------------
select pg_temp.expect_error('select private.set_staff_active(''00000000-0000-4000-8000-0000000005a1'', false)', '22023');
select private.set_staff_active('00000000-0000-4000-8000-0000000005b1', false);
select pg_temp.expect((select not active and deactivated_at is not null from public.staff
  where user_id = '00000000-0000-4000-8000-0000000005b1'), 'Dad deactivated');
select pg_temp.expect(private.active_staff_by_email('DAD@example.invalid') is null, 'no reset for a deactivated person');
select pg_temp.expect(private.active_staff_by_email(' Admin2@example.invalid') = '00000000-0000-4000-8000-0000000005a1', 'reset finds active staff');
-- Last-admin guard: with the original admin set aside, admin2 cannot be demoted or deactivated.
update public.staff set active = false, deactivated_at = now() where role = 'admin' and user_id <> '00000000-0000-4000-8000-0000000005a1';
update public.booking_settings set bookable_staff_user_id = (select value::uuid from r where name = 'owner');
select pg_temp.expect_error('select private.set_staff_role(''00000000-0000-4000-8000-0000000005a1'', ''staff'')', '22023');
select pg_temp.expect_error('select private.set_staff_active(''00000000-0000-4000-8000-0000000005a1'', false)', '22023');
update public.staff set active = true, deactivated_at = null where role = 'admin';

-- -------------------------------------------------------------------------------------------
-- deactivated: reads nothing, does nothing, gets no alerts or account emails
-- -------------------------------------------------------------------------------------------
set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-0000000005b1');
select pg_temp.expect(not public.is_staff(), 'deactivated is not staff');
select pg_temp.expect((select count(*) from public.enquiries) = 0, 'deactivated read no enquiries');
select pg_temp.expect((select count(*) from public.bookings) = 0, 'deactivated read no bookings');
select pg_temp.expect((select count(*) from public.staff) = 1, 'deactivated read only their own row');
select pg_temp.expect_error(format('select public.set_enquiry_status(%L, ''contacted'', null)',
  (select value from r where name = 'enquiry')), '42501');
select pg_temp.expect_error(format('select public.set_enquiry_outcome(%L, ''lost'', null, ''price'', null)',
  (select value from r where name = 'enquiry')), '42501');
update public.staff_availability set horizon_days = 77 where staff_user_id = '00000000-0000-4000-8000-0000000005b1';
reset role;
select pg_temp.expect((select horizon_days = 30 from public.staff_availability
  where staff_user_id = '00000000-0000-4000-8000-0000000005b1'), 'deactivated cannot edit availability');
select private.queue_staff_account_email('00000000-0000-4000-8000-0000000005b1', 'staff_password_reset', gen_random_uuid());
select pg_temp.expect(not exists (select 1 from public.communications where staff_user_id = '00000000-0000-4000-8000-0000000005b1'),
  'no account email to a deactivated person');
select private.queue_staff_alert((select value::uuid from r where name = 'enquiry'), 'staff_new_enquiry');
select pg_temp.expect(not exists (select 1 from public.communications where recipient = 'dad@example.invalid'),
  'no staff alert to a deactivated person');
-- Reactivated: back in.
select private.set_staff_active('00000000-0000-4000-8000-0000000005b1', true);
set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-0000000005b1');
select pg_temp.expect(public.is_staff(), 'reactivated is staff again');
reset role;

-- -------------------------------------------------------------------------------------------
-- Account emails: queued with no enquiry, one per request, sent without an enquiry event
-- -------------------------------------------------------------------------------------------
select private.queue_staff_account_email('00000000-0000-4000-8000-0000000005b1', 'staff_invite', '00000000-0000-4000-8000-0000000005ff');
select private.queue_staff_account_email('00000000-0000-4000-8000-0000000005b1', 'staff_invite', '00000000-0000-4000-8000-0000000005ff');
select pg_temp.expect((select count(*) = 1 from public.communications where staff_user_id = '00000000-0000-4000-8000-0000000005b1'
  and template = 'staff_invite' and recipient = 'dad@example.invalid' and enquiry_id is null), 'one invite per request');
select private.communication_sent((select id from public.communications where template = 'staff_invite'
  and staff_user_id = '00000000-0000-4000-8000-0000000005b1'), 'test');
select pg_temp.expect((select state = 'sent' from public.communications where template = 'staff_invite'
  and staff_user_id = '00000000-0000-4000-8000-0000000005b1'), 'account email marked sent');
select pg_temp.expect_error($$insert into public.communications (template, recipient, dedupe_key) values ('staff_invite', 'x@example.invalid', 'x')$$, '23514');
select pg_temp.expect_error($$insert into public.communications (template, recipient, dedupe_key, staff_user_id) values ('booking_confirmation', 'x@example.invalid', 'y', '00000000-0000-4000-8000-0000000005b1')$$, '23514');

-- Password-reset requests have their own limiter bucket.
select pg_temp.expect(private.rate_limit_take('password_reset', repeat('a', 64), null, 1), 'first reset allowed');
select pg_temp.expect(not private.rate_limit_take('password_reset', repeat('a', 64), null, 1), 'second reset limited');

rollback;
