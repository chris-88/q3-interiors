-- Slice 3 checks against the real database, in one transaction that is always rolled back.
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

create temp table r (name text primary key, value jsonb);
grant all on r to anon, authenticated, service_role;
create function pg_temp.id(p_name text) returns uuid language sql as $$
  select (value #>> '{}')::uuid from r where name = p_name
$$;
create function pg_temp.slot(p_days integer, p_minutes integer) returns timestamptz language sql as $$
  select ((current_date + p_days)::timestamp + make_interval(mins => p_minutes)) at time zone 'Europe/Dublin'
$$;
create function pg_temp.enquiry(p_name text, p_campaign text) returns uuid language plpgsql as $$
declare v jsonb; v_id uuid;
begin
  v := public.submit_enquiry_with_access(gen_random_uuid(), 'enquiry', 1, jsonb_build_object(
    'project_type', 'kitchen', 'description', 'Slice 3 test, rolled back.', 'location', 'D07',
    'timing', 'flexible', 'name', p_name, 'email', lower(p_name) || '@example.invalid', 'phone', '087 000 0000'),
    false, jsonb_build_object('utm_campaign', p_campaign));
  select id into v_id from public.enquiries where reference = v ->> 'reference';
  return v_id;
end;
$$;

-- -------------------------------------------------------------------------------------------
-- anon and non-staff get nothing
-- -------------------------------------------------------------------------------------------
set local role anon;
select pg_temp.expect_error('select * from public.booking_settings', '42501');
select pg_temp.expect_error('select * from public.funnel_report(current_date - 30, current_date)', '42501');
select pg_temp.expect_error('select public.set_booking_attendance(gen_random_uuid(), ''attended'')', '42501');
select pg_temp.expect_error('select public.set_enquiry_outcome(gen_random_uuid(), ''won'')', '42501');
select pg_temp.expect_error('select private.cancel_booking(gen_random_uuid(), ''customer'', null)', '42501');
select pg_temp.expect_error('select private.reschedule_booking(gen_random_uuid(), now(), ''customer'')', '42501');
reset role;

insert into auth.users (id, aud, role, email)
values ('00000000-0000-4000-8000-0000000000e1', 'authenticated', 'authenticated', 'outsider3@example.invalid');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000000e1", "role": "authenticated"}', true);
select pg_temp.expect((select count(*) from public.booking_settings) = 0, 'non-staff see no settings');
select pg_temp.expect_error('select * from public.funnel_report(current_date - 30, current_date)', '42501');
select pg_temp.expect_error('select public.set_enquiry_outcome(gen_random_uuid(), ''won'')', '42501');
select pg_temp.expect_error('select public.set_booking_attendance(gen_random_uuid(), ''attended'')', '42501');
select pg_temp.expect_error('update public.bookings set attendance = ''attended''', '42501');
reset role;

-- -------------------------------------------------------------------------------------------
-- Book, confirm, reminder exactly once
-- -------------------------------------------------------------------------------------------
insert into r values ('a', to_jsonb(pg_temp.enquiry('Alpha', 'camp_one')));
insert into r values ('b', to_jsonb(pg_temp.enquiry('Bravo', 'camp_one')));
insert into r values ('c', to_jsonb(pg_temp.enquiry('Charlie', null)));

set local role service_role;
insert into r values ('ba', private.reserve_booking(pg_temp.id('a'), 'phone_consultation', pg_temp.slot(10, 600), gen_random_uuid()) -> 'booking_id');
select private.complete_calendar_job((select id from public.integration_jobs where booking_id = pg_temp.id('ba')), null);
select pg_temp.expect((select state = 'confirmed' from public.bookings where id = pg_temp.id('ba')), 'confirmed');
select private.schedule_reminder(pg_temp.id('ba'), pg_temp.slot(9, 600));
select private.schedule_reminder(pg_temp.id('ba'), pg_temp.slot(9, 600));
select pg_temp.expect((select count(*) from public.communications
  where booking_id = pg_temp.id('ba') and template = 'booking_reminder') = 1, 'one reminder per booking and start');

-- -------------------------------------------------------------------------------------------
-- Reschedule: same id and event id, update job, old reminder skipped, email, history
-- -------------------------------------------------------------------------------------------
insert into r select 'event_id', to_jsonb(calendar_event_id) from public.bookings where id = pg_temp.id('ba');
insert into r values ('mv', private.reschedule_booking(pg_temp.id('ba'), pg_temp.slot(11, 660), 'customer'));
select pg_temp.expect((select value ->> 'status' from r where name = 'mv') = 'rescheduled', 'rescheduled');
select pg_temp.expect((select starts_at = pg_temp.slot(11, 660) and reschedule_count = 1
  and calendar_event_id = (select value #>> '{}' from r where name = 'event_id')
  from public.bookings where id = pg_temp.id('ba')), 'same booking and event id at the new time');
select pg_temp.expect((select count(*) from public.integration_jobs
  where booking_id = pg_temp.id('ba') and kind = 'update_calendar_event' and state = 'queued') = 1, 'one update job');
select pg_temp.expect((select state = 'skipped' from public.communications
  where booking_id = pg_temp.id('ba') and template = 'booking_reminder'), 'old reminder skipped');
select pg_temp.expect((select count(*) from public.communications
  where booking_id = pg_temp.id('ba') and template = 'booking_rescheduled') = 1, 'reschedule email queued');
select pg_temp.expect((select value -> 'changed' from r where name = 'mv') = 'true', 'changed');
-- Regression (2026-11-23): the create-job path must never claim or complete an update job.
select pg_temp.expect((select count(*) from private.claim_calendar_jobs(10, pg_temp.id('ba'))) = 0,
  'create claim ignores update jobs');
select pg_temp.expect_error(format('select private.complete_calendar_job(%s, null)',
  (select id from public.integration_jobs where booking_id = pg_temp.id('ba') and kind = 'update_calendar_event')), '22023');
select pg_temp.expect((private.reschedule_booking(pg_temp.id('ba'), pg_temp.slot(11, 660), 'customer') ->> 'changed') = 'false',
  'repeating a reschedule is a no-op');
-- The reminder follows the reschedule: a new start gets its own reminder row.
select private.schedule_reminder(pg_temp.id('ba'), pg_temp.slot(10, 660));
select pg_temp.expect((select count(*) from public.communications
  where booking_id = pg_temp.id('ba') and template = 'booking_reminder' and state = 'queued') = 1, 'new reminder for the new time');

-- B takes A's old time; A cannot move onto B.
insert into r values ('bb', private.reserve_booking(pg_temp.id('b'), 'phone_consultation', pg_temp.slot(10, 600), gen_random_uuid()) -> 'booking_id');
select pg_temp.expect((select value ->> 'booking_id' from r where name = 'bb') is null
  and (select value is not null from r where name = 'bb'), 'B reserved the freed slot');
insert into r values ('clash', private.reschedule_booking(pg_temp.id('ba'), pg_temp.slot(10, 600), 'customer'));
select pg_temp.expect((select value ->> 'reason' from r where name = 'clash') = 'taken', 'lost race refused');
select pg_temp.expect((select starts_at = pg_temp.slot(11, 660) from public.bookings where id = pg_temp.id('ba')), 'old time kept');

-- A sync job that wrote an old time goes back in the queue; one that succeeds clears flags.
update public.integration_jobs set state = 'running' where booking_id = pg_temp.id('ba') and kind = 'update_calendar_event';
select private.complete_sync_job((select id from public.integration_jobs where booking_id = pg_temp.id('ba') and kind = 'update_calendar_event'),
  pg_temp.slot(10, 600), 'stale');
select pg_temp.expect((select state = 'queued' from public.integration_jobs
  where booking_id = pg_temp.id('ba') and kind = 'update_calendar_event'), 'stale sync requeued');
select private.fail_sync_job((select id from public.integration_jobs where booking_id = pg_temp.id('ba') and kind = 'update_calendar_event'), 'Google 500');
select pg_temp.expect((select calendar_mismatch like 'Could not move%' from public.bookings where id = pg_temp.id('ba')),
  'failed move flagged for staff');
select private.record_reconcile(pg_temp.id('ba'), null);
select pg_temp.expect((select calendar_mismatch is null from public.bookings where id = pg_temp.id('ba')), 'reconcile clears');

-- -------------------------------------------------------------------------------------------
-- Cancel
-- -------------------------------------------------------------------------------------------
select pg_temp.expect((private.cancel_booking(pg_temp.id('ba'), 'customer', 'Changed my mind') ->> 'changed') = 'true', 'cancelled');
select pg_temp.expect((private.cancel_booking(pg_temp.id('ba'), 'customer', null) ->> 'changed') = 'false', 'cancel is idempotent');
select pg_temp.expect((select state = 'cancelled' and cancelled_by = 'customer' from public.bookings where id = pg_temp.id('ba')), 'state');
select pg_temp.expect((select count(*) from public.integration_jobs
  where booking_id = pg_temp.id('ba') and kind = 'delete_calendar_event' and state = 'queued') = 1, 'one delete job');
select pg_temp.expect(not exists (select 1 from public.communications
  where booking_id = pg_temp.id('ba') and template = 'booking_reminder' and state = 'queued'), 'no reminder for a cancelled booking');
select private.schedule_reminder(pg_temp.id('ba'), now());
select pg_temp.expect(not exists (select 1 from public.communications
  where booking_id = pg_temp.id('ba') and template = 'booking_reminder' and state = 'queued'), 'reminders never scheduled for cancelled');
select pg_temp.expect((select count(*) from public.communications
  where booking_id = pg_temp.id('ba') and template = 'booking_cancelled') = 1, 'cancellation email queued');
select pg_temp.expect((private.reschedule_booking(pg_temp.id('ba'), pg_temp.slot(12, 600), 'customer') ->> 'status') = 'not_live',
  'a cancelled booking cannot move');
-- Its slot is free: A can book again.
select pg_temp.expect((private.reserve_booking(pg_temp.id('a'), 'phone_consultation', pg_temp.slot(11, 660), gen_random_uuid()) ->> 'status') = 'reserved',
  'cancelled slot released');

-- Cancelled while the event was being created: the create job does not confirm and re-queues a delete.
insert into r values ('bc', private.reserve_booking(pg_temp.id('c'), 'phone_consultation', pg_temp.slot(12, 600), gen_random_uuid()) -> 'booking_id');
select private.cancel_booking(pg_temp.id('bc'), 'staff', null);
update public.integration_jobs set state = 'succeeded' where booking_id = pg_temp.id('bc') and kind = 'delete_calendar_event';
select private.complete_calendar_job((select id from public.integration_jobs where booking_id = pg_temp.id('bc') and kind = 'create_calendar_event'), null);
select pg_temp.expect((select state = 'cancelled' from public.bookings where id = pg_temp.id('bc')), 'stays cancelled');
select pg_temp.expect((select count(*) from public.integration_jobs
  where booking_id = pg_temp.id('bc') and kind = 'delete_calendar_event' and state = 'queued') = 1, 'delete re-queued');
reset role;

-- -------------------------------------------------------------------------------------------
-- Staff: attendance, outcome, report
-- -------------------------------------------------------------------------------------------
-- Put B's booking in the past and confirm it.
update public.bookings set starts_at = now() - interval '2 hours', ends_at = now() - interval '100 minutes',
  blocked = tstzrange(now() - interval '2 hours', now() - interval '90 minutes')
where id = pg_temp.id('bb');
set local role service_role;
select private.complete_calendar_job((select id from public.integration_jobs where booking_id = pg_temp.id('bb') and kind = 'create_calendar_event'), null);
reset role;

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', public.bookable_staff(), 'role', 'authenticated')::text, true);
select pg_temp.expect_error(format('select public.set_booking_attendance(%L, ''attended'')',
  (select id from public.bookings where enquiry_id = pg_temp.id('a') and state <> 'cancelled')), '22023');
select public.set_booking_attendance(pg_temp.id('bb'), 'attended');
select pg_temp.expect((select attendance = 'attended' from public.bookings where id = pg_temp.id('bb')), 'attended');

select pg_temp.expect_error(format('select public.set_enquiry_outcome(%L, ''lost'')', pg_temp.id('a')), '22023');
select pg_temp.expect_error(format('select public.set_enquiry_outcome(%L, ''lost'', null, ''other'', '' '')', pg_temp.id('a')), '22023');
select pg_temp.expect_error(format('select public.set_enquiry_outcome(%L, ''lost'', 100, ''price'')', pg_temp.id('a')), '22023');
select pg_temp.expect_error(format('select public.set_enquiry_outcome(%L, ''lost'', null, ''nope'')', pg_temp.id('a')), '23514');
select public.set_enquiry_outcome(pg_temp.id('a'), 'lost', null, 'price', 'Too dear');
select public.set_enquiry_outcome(pg_temp.id('b'), 'won', 12500, null, null);
select pg_temp.expect((select outcome = 'won' and outcome_value = 12500 from public.enquiries where id = pg_temp.id('b')), 'won with value');
select public.set_enquiry_outcome(pg_temp.id('c'), 'won');
select public.set_enquiry_outcome(pg_temp.id('c'), null);
select pg_temp.expect((select outcome is null from public.enquiries where id = pg_temp.id('c')), 'outcome cleared');
select pg_temp.expect((select count(*) from public.enquiry_events
  where enquiry_id in (pg_temp.id('a'), pg_temp.id('b'), pg_temp.id('c')) and kind in ('outcome_recorded', 'outcome_cleared', 'attendance_recorded')) = 5,
  'outcomes and attendance in history');

-- camp_one: A (booked, cancelled, lost) and B (booked, attended, won).
select pg_temp.expect((select enquiries = 2 and booked = 2 and attended = 1 and won = 1 and cancelled = 1 and no_shows = 0 and won_value = 12500
  from public.funnel_report(current_date, current_date) where campaign = 'camp_one'), 'funnel for camp_one');
select pg_temp.expect(-- Live enquiries from today may also be untagged (and booked), so only the grouping is checked.
  (select enquiries >= 1 from public.funnel_report(current_date, current_date) where campaign = '(unknown)'),
  'untagged enquiries grouped as unknown');
select pg_temp.expect_error('select * from public.funnel_report(current_date, current_date - 1)', '22023');
update public.booking_settings set reminder_lead_minutes = 60;
select pg_temp.expect((select reminder_lead_minutes = 60 from public.booking_settings), 'staff edit settings');
select pg_temp.expect_error('update public.booking_settings set id = false', '42501');
reset role;

select 'change checks passed';
rollback;
