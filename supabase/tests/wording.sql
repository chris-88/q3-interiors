-- Slice 5 wording blocks: who reads and writes them. One transaction, always rolled back.
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
  ('00000000-0000-4000-8000-0000000007b1', 'authenticated', 'authenticated', 'staff7@example.invalid');
select private.add_staff('00000000-0000-4000-8000-0000000007b1', 'staff7@example.invalid', 'Staff Seven', 'staff');
delete from public.message_blocks;

-- anon: only the public disclaimer, through the function.
set local role anon;
select pg_temp.expect_error('select * from public.message_blocks', '42501');
select pg_temp.expect((public.public_wording() ->> 'visit_disclaimer') is null, 'default disclaimer is null');
reset role;

-- staff: read, no writes.
set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-0000000007b1');
select pg_temp.expect_error($$insert into public.message_blocks (key, body) values ('sign_off', 'Hacked')$$, '42501');
reset role;

-- admin: add, change, reset; the table refuses bad keys, long text and control characters.
set local role authenticated;
select pg_temp.as_user(public.bookable_staff()::text);
insert into public.message_blocks (key, body) values ('visit_disclaimer', 'We come to look and price it.');
update public.message_blocks set body = 'We come to look, measure and price it.' where key = 'visit_disclaimer';
select pg_temp.expect_error($$insert into public.message_blocks (key, body) values ('Bad Key!', 'x')$$, '23514');
select pg_temp.expect_error($$insert into public.message_blocks (key, body) values ('sign_off', repeat('x', 601))$$, '23514');
select pg_temp.expect_error($$insert into public.message_blocks (key, body) values ('sign_off', E'bell\x07')$$, '23514');
reset role;
set local role anon;
select pg_temp.expect((public.public_wording() ->> 'visit_disclaimer') = 'We come to look, measure and price it.', 'public sees the rewording');
reset role;
set local role authenticated;
select pg_temp.as_user(public.bookable_staff()::text);
delete from public.message_blocks where key = 'visit_disclaimer';
reset role;
select pg_temp.expect(not exists (select 1 from public.message_blocks), 'reset to default removes the row');

-- staff cannot delete either (RLS: nothing happens).
insert into public.message_blocks (key, body) values ('sign_off', 'The Q3 team');
set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-0000000007b1');
delete from public.message_blocks;
reset role;
select pg_temp.expect(exists (select 1 from public.message_blocks where key = 'sign_off'), 'staff cannot reset wording');

rollback;
