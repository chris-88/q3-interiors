-- Slice 5, part 3: reworded text blocks for the emails (and the visit disclaimer on the booked
-- page). Only blocks an admin has changed are stored; the defaults live in messages.ts, so "reset
-- to default" deletes the row. Blocks are plain text inside a fixed structure: the renderer
-- escapes them and checks their tokens again, so a row can never add HTML or remove the date,
-- reference, links or plain-text part.

create table public.message_blocks (
  key text primary key check (key ~ '^[a-z_]+(\.[a-z_]+)?$' and char_length(key) <= 60),
  body text not null check (char_length(body) <= 600 and body !~ '[\x01-\x08\x0b-\x1f\x7f]'),
  updated_at timestamptz not null default now(),
  updated_by_name text
);

comment on table public.message_blocks is
  'Admin rewording of named email text blocks (defaults in supabase/functions/_shared/messages.ts).';

revoke all on table public.message_blocks from public, anon, authenticated;
grant select, insert, update, delete on table public.message_blocks to authenticated;
grant select, insert, update, delete on table public.message_blocks to service_role;
alter table public.message_blocks enable row level security;
create policy "staff read wording" on public.message_blocks
  for select to authenticated using ((select public.is_staff()));
create policy "admins add wording" on public.message_blocks
  for insert to authenticated with check ((select public.is_admin()));
create policy "admins change wording" on public.message_blocks
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "admins reset wording" on public.message_blocks
  for delete to authenticated using ((select public.is_admin()));

-- Public pages show one block: the visit disclaimer (null means use the default).
create function public.public_wording()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'visit_disclaimer', (select body from public.message_blocks where key = 'visit_disclaimer'));
$$;

revoke all on function public.public_wording() from public, anon, authenticated;
grant execute on function public.public_wording() to anon, authenticated, service_role;
