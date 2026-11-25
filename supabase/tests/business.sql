-- Slice 5 business details: who reads and writes what. One transaction, always rolled back.
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
  ('00000000-0000-4000-8000-0000000006b1', 'authenticated', 'authenticated', 'staff6@example.invalid'),
  ('00000000-0000-4000-8000-0000000006c1', 'authenticated', 'authenticated', 'off6@example.invalid');
select private.add_staff('00000000-0000-4000-8000-0000000006b1', 'staff6@example.invalid', 'Staff Six', 'staff');
select private.add_staff('00000000-0000-4000-8000-0000000006c1', 'off6@example.invalid', 'Off Six', 'staff');
select private.set_staff_active('00000000-0000-4000-8000-0000000006c1', false);
update public.business_details set legal_name = 'Test Legal Ltd', contact_phone = '01 555 0100',
  contact_email = 'hello@example.invalid', postal_address = null, privacy_contact = null,
  service_area = null, privacy_reviewed_at = null;

-- anon: the public function only, and only public fields.
set local role anon;
select pg_temp.expect_error('select * from public.business_details', '42501');
select pg_temp.expect((select public.public_business_details() ->> 'legal_name') = 'Test Legal Ltd', 'anon reads public details');
select pg_temp.expect((select public.public_business_details() ? 'updated_at') = false, 'no internal fields');
select pg_temp.expect((select public.public_business_details() ? 'retention_months'), 'retention period for the notice');
select pg_temp.expect((select public.public_business_details() ->> 'privacy_reviewed') = 'false', 'review flag exposed as a boolean');
reset role;

-- staff: read, not write.
set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-0000000006b1');
select pg_temp.expect((select count(*) from public.business_details) = 1, 'staff read details');
update public.business_details set legal_name = 'Hijacked Ltd';
reset role;
select pg_temp.expect((select legal_name = 'Test Legal Ltd' from public.business_details), 'staff cannot change details');

-- deactivated: nothing.
set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-0000000006c1');
select pg_temp.expect((select count(*) from public.business_details) = 0, 'deactivated read nothing');
reset role;

-- admin: writes, with validation; the privacy review needs the legal details.
set local role authenticated;
select pg_temp.as_user(public.bookable_staff()::text);
update public.business_details set service_area = 'Dublin and north Kildare';
select pg_temp.expect_error('update public.business_details set contact_email = ''not an email''', '23514');
select pg_temp.expect_error('update public.business_details set contact_phone = ''call me maybe''', '23514');
select pg_temp.expect_error('update public.business_details set privacy_reviewed_at = now()', '23514');
update public.business_details set postal_address = '1 Test Street, Dublin 7', privacy_contact = 'privacy@example.invalid',
  privacy_reviewed_at = now();
select pg_temp.expect_error('update public.business_details set legal_name = null', '23514');
select pg_temp.expect_error('update public.business_details set id = false', '42501');
reset role;
select pg_temp.expect((select service_area = 'Dublin and north Kildare' and privacy_reviewed_at is not null
  from public.business_details), 'admin changes details and marks the notice reviewed');
set local role anon;
select pg_temp.expect((select public.public_business_details() ->> 'privacy_reviewed') = 'true', 'public sees the review');
reset role;

rollback;
