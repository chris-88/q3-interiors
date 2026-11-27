-- The Ads page by campaign (2026-11-30). Chris: "follow the cherry: which campaign published which
-- ads, then which of them were most successful, and then which inquiries relate to each".
--
-- 1. campaign_creatives.running: which of a campaign's ads are actually running (Chris will run
--    4 of 8). Admins tick it on the Ads page; RLS and the existing table grant already limit
--    updates to admins.
-- 2. private.attach_tagged_ads(campaign slug, name): makes the campaign and one creative per live
--    ad whose current version's link carries utm_campaign=<slug>, with the creative's slug taken
--    from that link's utm_content, and links the ad to it. It reads the tags from the links the
--    ads already carry, so those links stay valid; the campaign's source and medium are taken
--    from the same links (the "Type test 1" ads say medium=paid, so the campaign's link builder
--    agrees with them). Idempotent; with no such ads it does nothing (CI, fresh setups).
-- 3. Run it once for the eight live "Type test 1" ads.

alter table public.campaign_creatives
  add column running boolean not null default false;
comment on column public.campaign_creatives.running is
  'This ad is running in the campaign now (ticked by an admin on the Ads page).';

create function private.attach_tagged_ads(p_slug text, p_name text)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_campaign uuid;
  v_linked integer;
begin
  create temporary table tagged on commit drop as
  select a.id as ad_id, a.name,
         substring(v.link_url from '[?&]utm_source=([a-z0-9_-]+)') as source,
         substring(v.link_url from '[?&]utm_medium=([a-z0-9_-]+)') as medium,
         substring(v.link_url from '[?&]utm_content=([a-z0-9]+(?:-[a-z0-9]+)*)(?:[&#]|$)') as content,
         a.created_at
  from public.ads a
  join lateral (
    select link_url from public.ad_versions where ad_id = a.id order by version desc limit 1
  ) v on true
  where a.status <> 'archived'
    and v.link_url ~ ('[?&]utm_campaign=' || p_slug || '([&#]|$)');
  delete from tagged where content is null or char_length(content) > 60;

  if not exists (select 1 from tagged) then
    drop table tagged;
    return 0;
  end if;

  insert into public.campaigns (name, slug, utm_source, utm_medium, landing_route, link_used_at)
  select p_name, p_slug,
         coalesce((select source from tagged where source is not null order by created_at limit 1), 'instagram'),
         coalesce((select medium from tagged where medium is not null order by created_at limit 1), 'paid_social'),
         '/', now()
  on conflict (slug) do nothing;
  select id into v_campaign from public.campaigns where slug = p_slug;

  insert into public.campaign_creatives (campaign_id, label, slug)
  select distinct on (content) v_campaign, left(btrim(name), 80), content
  from tagged order by content, created_at
  on conflict (campaign_id, slug) do nothing;

  update public.ads a
  set campaign_creative_id = c.id
  from tagged t
  join public.campaign_creatives c on c.campaign_id = v_campaign and c.slug = t.content
  where a.id = t.ad_id and a.campaign_creative_id is null;
  get diagnostics v_linked = row_count;
  drop table tagged;
  return v_linked;
end;
$$;
revoke all on function private.attach_tagged_ads(text, text) from public, anon, authenticated;

select private.attach_tagged_ads('type-test-1', 'Type test 1');
