-- Slice 5, part 4: campaigns, their creatives (utm_content labels) and spend. The first piece of
-- a later "ad studio": a creative is its own row so an ad can attach to it later. Campaigns and
-- creatives are readable by staff (the report names them) and changed by admins; spend is admin
-- only, end to end.

create table public.campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 80),
  -- Used as utm_campaign: lower-case words joined by hyphens.
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) between 2 and 60),
  utm_source text not null default 'instagram' check (utm_source ~ '^[a-z0-9]+([_-][a-z0-9]+)*$' and char_length(utm_source) <= 40),
  utm_medium text not null default 'paid_social' check (utm_medium ~ '^[a-z0-9]+([_-][a-z0-9]+)*$' and char_length(utm_medium) <= 40),
  landing_route text not null default '/' check (landing_route in ('/', '/enquire')),
  notes text check (notes is null or char_length(notes) <= 1000),
  archived_at timestamptz,
  -- Set the first time a link is copied or tested: from then on the slug is in the wild.
  link_used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.campaign_creatives (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  label text not null check (char_length(btrim(label)) between 1 and 80),
  -- Used as utm_content.
  slug text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) between 1 and 60),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  unique (campaign_id, slug)
);

create table public.campaign_spend (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  spent_on date not null,
  -- Euro cents, so sums are exact.
  amount_cents integer not null check (amount_cents between 1 and 100000000),
  note text check (note is null or char_length(note) <= 200),
  created_by_name text,
  created_at timestamptz not null default now()
);

create index campaign_spend_by_day on public.campaign_spend (campaign_id, spent_on);

-- A slug that links already carry cannot change (it would split the campaign's numbers).
create function private.campaign_slug_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.slug is distinct from old.slug and (
    old.link_used_at is not null
    or exists (select 1 from public.enquiry_attribution where utm_campaign = old.slug)
  ) then
    raise exception 'slug in use' using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger campaign_slug_guard before update on public.campaigns
  for each row execute function private.campaign_slug_guard();

create function private.creative_slug_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.slug is distinct from old.slug and (
    (select link_used_at from public.campaigns where id = old.campaign_id) is not null
    or exists (select 1 from public.enquiry_attribution a join public.campaigns c on c.slug = a.utm_campaign
               where c.id = old.campaign_id and a.utm_content = old.slug)
  ) then
    raise exception 'slug in use' using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger creative_slug_guard before update on public.campaign_creatives
  for each row execute function private.creative_slug_guard();

-- The link builder records that a link left the building.
create function public.mark_campaign_link_used(p_campaign_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  update public.campaigns set link_used_at = coalesce(link_used_at, now()) where id = p_campaign_id;
end;
$$;

-- Spend per campaign slug in a date range, for the report. Admins only.
create function public.campaign_costs(p_from date, p_to date)
returns table (campaign text, name text, spend_cents bigint, spend_entries bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 3660 then
    raise exception 'invalid date range' using errcode = '22023';
  end if;
  return query
  select c.slug, c.name,
         coalesce(sum(s.amount_cents), 0)::bigint,
         count(s.id)::bigint
  from public.campaigns c
  left join public.campaign_spend s on s.campaign_id = c.id and s.spent_on between p_from and p_to
  group by c.slug, c.name;
end;
$$;

-- Privileges and RLS
revoke all on table public.campaigns, public.campaign_creatives, public.campaign_spend from public, anon, authenticated;
grant select, insert, update, delete on table public.campaigns, public.campaign_creatives to authenticated;
grant select, insert, update, delete on table public.campaign_spend to authenticated;
grant select, insert, update, delete on table public.campaigns, public.campaign_creatives, public.campaign_spend to service_role;
-- link_used_at is only set through mark_campaign_link_used.
revoke update on table public.campaigns from authenticated;
grant update (name, slug, utm_source, utm_medium, landing_route, notes, archived_at, updated_at)
  on public.campaigns to authenticated;

alter table public.campaigns enable row level security;
alter table public.campaign_creatives enable row level security;
alter table public.campaign_spend enable row level security;

create policy "staff read campaigns" on public.campaigns
  for select to authenticated using ((select public.is_staff()));
create policy "admins add campaigns" on public.campaigns
  for insert to authenticated with check ((select public.is_admin()));
create policy "admins change campaigns" on public.campaigns
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "admins remove unused campaigns" on public.campaigns
  for delete to authenticated using ((select public.is_admin()) and link_used_at is null);

create policy "staff read creatives" on public.campaign_creatives
  for select to authenticated using ((select public.is_staff()));
create policy "admins add creatives" on public.campaign_creatives
  for insert to authenticated with check ((select public.is_admin()));
create policy "admins change creatives" on public.campaign_creatives
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "admins remove creatives" on public.campaign_creatives
  for delete to authenticated using ((select public.is_admin()));

create policy "admins read spend" on public.campaign_spend
  for select to authenticated using ((select public.is_admin()));
create policy "admins add spend" on public.campaign_spend
  for insert to authenticated with check ((select public.is_admin()));
create policy "admins change spend" on public.campaign_spend
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "admins remove spend" on public.campaign_spend
  for delete to authenticated using ((select public.is_admin()));

revoke all on function public.mark_campaign_link_used(uuid) from public, anon, authenticated;
revoke all on function public.campaign_costs(date, date) from public, anon, authenticated;
grant execute on function public.mark_campaign_link_used(uuid) to authenticated;
grant execute on function public.campaign_costs(date, date) to authenticated;
revoke all on all functions in schema private from public, anon, authenticated;
grant execute on all functions in schema private to service_role;
