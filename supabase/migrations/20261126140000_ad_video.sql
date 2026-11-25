-- Slice 6, part C: animated ads. A variant exports either an image (PNG, still ads) or a video
-- (MP4, animated ads), with its loop length and a poster image for the list and as the still
-- fallback. Written only by the publish command, as before.

alter table public.ad_variants
  add column export_type text not null default 'image' check (export_type in ('image', 'video')),
  add column duration_ms integer check (duration_ms is null or duration_ms between 1000 and 15000),
  add column poster_path text check (poster_path is null or poster_path ~ '^[a-z0-9/_.-]+\.png$'),
  add constraint ad_variants_export_kind check (
    (export_type = 'image' and duration_ms is null and poster_path is null and export_path ~ '\.(png|jpg)$')
    or (export_type = 'video' and duration_ms is not null and poster_path is not null and export_path ~ '\.mp4$'));

comment on column public.ad_variants.poster_path is
  'Animated variants: the last frame as PNG (the settled message), shown in lists and as the still fallback.';
