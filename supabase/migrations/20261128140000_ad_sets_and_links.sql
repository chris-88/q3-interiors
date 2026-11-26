-- Ads screens redesign: ads belong to a named set in a given order, their title is the headline
-- alone, and each version carries the link the ad points to.
--
-- 1. ads.set_name and ads.set_position: the list groups by set (newest set first) and orders by
--    position. Written by ad:publish from ad.json ("set", "position"); older builds ignore them.
-- 2. ad_versions.link_url: the destination link for that version (ad.json "link"), shown and
--    copyable on the ad page. https only.
-- 3. The ads published before this (the "Type test 1" set and the two samples) are brought into
--    that shape: clean titles, set and position, and the link that sat in each version's notes.
--    The rules are two private functions so they can be tested; notes are left unchanged.

alter table public.ads
  add column set_name text check (set_name is null or char_length(btrim(set_name)) between 1 and 80),
  add column set_position integer check (set_position is null or set_position between 1 and 999);

alter table public.ad_versions
  add column link_url text check (
    link_url is null or (char_length(link_url) <= 2000 and link_url ~ '^https://[^[:space:]]+$'));

comment on column public.ads.set_name is 'The set the ad belongs to, e.g. "Type test 1"; the list groups by it.';
comment on column public.ads.set_position is 'Order within the set (1 first).';
comment on column public.ad_versions.link_url is 'Where the ad points (with its tags), as published.';

-- The link that ad:new wrote into the notes before there was a field for it.
create function private.legacy_ad_link(p_notes text)
returns text
language sql
immutable
set search_path = ''
as $$
  select substring(p_notes from 'Link for the ad: (https://[^[:space:]]+)');
$$;

-- Title, set and position for an ad named the old way:
--   "Type test 1 · 3. A new kitchen shouldn't take ten phone calls (animated)"
--   "Sample (animated): Planning a home renovation? (type only)"
-- The title is the current version's headline when there is one (it is the artwork's headline),
-- else the name without its prefix and suffix. Animated before still within a number. NULL title
-- for any other name: left as it is.
create function private.legacy_ad_shape(p_name text, p_headline text)
returns table (title text, set_name text, set_position integer)
language plpgsql
immutable
set search_path = ''
as $$
declare
  m text[];
  t text;
begin
  m := regexp_match(p_name, '^Type test 1 · ([0-9]+)\. (.+) \((animated|still)\)$');
  if m is not null then
    t := coalesce(p_headline, replace(m[2], '''', '’'));
    if t !~ '[.?!]$' then
      t := t || '.';
    end if;
    return query select t, 'Type test 1'::text,
      (m[1]::integer * 2 - case when m[3] = 'animated' then 1 else 0 end);
    return;
  end if;
  m := regexp_match(p_name, '^Sample( \(animated\))?: (.+)$');
  if m is not null then
    return query select regexp_replace(m[2], ' \(type only\)$', ''), 'Samples'::text,
      case when m[1] is null then 1 else 2 end;
    return;
  end if;
  return query select null::text, null::text, null::integer;
end;
$$;

revoke all on function private.legacy_ad_link(text), private.legacy_ad_shape(text, text)
  from public, anon, authenticated;

update public.ad_versions
set link_url = private.legacy_ad_link(notes)
where link_url is null and private.legacy_ad_link(notes) is not null;

with shaped as (
  select a.id, s.title, s.set_name, s.set_position
  from public.ads a
  cross join lateral (
    select headline from public.ad_versions v where v.ad_id = a.id order by v.version desc limit 1
  ) cur
  cross join lateral private.legacy_ad_shape(a.name, cur.headline) s
  where a.set_name is null
)
update public.ads a
set name = shaped.title, set_name = shaped.set_name, set_position = shaped.set_position,
    updated_at = now()
from shaped
where a.id = shaped.id and shaped.title is not null;
