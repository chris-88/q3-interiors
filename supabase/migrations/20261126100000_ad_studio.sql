-- Slice 6, part A: the ad studio's records and private storage.
--
-- An ad has versions (part B adds edit requests and new versions); each version has one variant
-- per size, each a self-contained HTML file and the PNG rendered from it, both kept in the private
-- `ads` bucket. Everything is written by the local publish command with the service role; staff
-- only read. Status values already cover part B's review flow.

create type public.ad_status as enum ('new', 'changes_requested', 'approved', 'archived');

create table public.ads (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  status public.ad_status not null default 'new',
  -- The campaign creative whose tagged link the ad uses (optional).
  campaign_creative_id uuid references public.campaign_creatives (id) on delete set null,
  created_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.ad_versions (
  id uuid primary key default gen_random_uuid(),
  ad_id uuid not null references public.ads (id) on delete cascade,
  version integer not null check (version >= 1),
  caption text not null check (char_length(caption) between 1 and 2200),
  headline text check (headline is null or char_length(headline) between 1 and 40),
  button_label text check (button_label is null or char_length(button_label) between 1 and 30),
  notes text check (notes is null or char_length(notes) <= 2000),
  created_by_name text,
  created_at timestamptz not null default now(),
  unique (ad_id, version)
);

create table public.ad_variants (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references public.ad_versions (id) on delete cascade,
  size text not null check (size in ('portrait', 'vertical', 'square')),
  width integer not null check (width between 500 and 4096),
  height integer not null check (height between 500 and 8192),
  -- Object paths in the private `ads` bucket.
  html_path text not null check (html_path ~ '^[a-z0-9/_.-]+\.html$'),
  export_path text not null check (export_path ~ '^[a-z0-9/_.-]+\.(png|jpg|mp4)$'),
  export_bytes integer check (export_bytes is null or export_bytes > 0),
  created_at timestamptz not null default now(),
  unique (version_id, size)
);

create index ad_versions_by_ad on public.ad_versions (ad_id, version desc);
create index ad_variants_by_version on public.ad_variants (version_id);

comment on table public.ads is
  'Ads built by the local ad studio (npm run ad:publish); staff read, the service role writes.';

revoke all on table public.ads, public.ad_versions, public.ad_variants from public, anon, authenticated;
grant select on table public.ads, public.ad_versions, public.ad_variants to authenticated;
grant select, insert, update, delete on table public.ads, public.ad_versions, public.ad_variants to service_role;
alter table public.ads enable row level security;
alter table public.ad_versions enable row level security;
alter table public.ad_variants enable row level security;
create policy "staff read ads" on public.ads
  for select to authenticated using ((select public.is_staff()));
create policy "staff read ad versions" on public.ad_versions
  for select to authenticated using ((select public.is_staff()));
create policy "staff read ad variants" on public.ad_variants
  for select to authenticated using ((select public.is_staff()));

-- Private storage: no public URL, no anonymous access; active staff read through the storage API
-- with their own session; only the service role writes.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('ads', 'ads', false, 31457280, array['text/html', 'image/png', 'image/jpeg', 'video/mp4'])
on conflict (id) do update set public = false;

create policy "staff read ad files" on storage.objects
  for select to authenticated using (bucket_id = 'ads' and (select public.is_staff()));
