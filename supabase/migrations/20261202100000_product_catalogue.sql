-- The product list holds a supplier catalogue (2026-11-28; Chris: "go on to goodwins.ie and scrape
-- all products and add to product list"). A product is either Dad's own (source null) or a
-- supplier's (source = a slug such as 'goodwins', with the supplier's SKU, page, category and the
-- date its price was last checked). Catalogue prices are VAT-inclusive as the supplier shows them.
--
-- Names: Dad's own products keep one per name in any case; catalogue names may repeat and may
-- equal one of his, so the unique name rule now covers own products only. A catalogue product is
-- one per (source, SKU).
--
-- Price edits: when staff change a catalogue product's usual price, price_edited_at is set and a
-- later import keeps that price, recording the supplier's in supplier_price_cents to show beside it.
-- An import never un-archives, and never touches a job's lines (they keep their own snapshot).
--
-- Search runs on the server (find_products): every word must match the name (any order) or start
-- the SKU; products used on a job first, then Dad's own, then the catalogue. A trigram index keeps
-- it fast at catalogue size.

create extension if not exists pg_trgm with schema extensions;

alter table public.products
  drop constraint products_name_check,
  add constraint products_name_check check (char_length(name) between 2 and 200 and name = btrim(name)),
  add column source text check (source is null or source ~ '^[a-z][a-z0-9-]{1,30}$'),
  add column supplier_sku text check (supplier_sku is null or char_length(supplier_sku) between 1 and 60),
  add column source_url text check (source_url is null or (source_url ~ '^https://' and char_length(source_url) <= 500)),
  add column category text check (category is null or char_length(category) between 1 and 200),
  add column price_checked_at timestamptz,
  add column supplier_price_cents integer check (supplier_price_cents is null or supplier_price_cents between 0 and 100000000),
  add column price_edited_at timestamptz,
  add constraint products_source_sku check ((source is null) = (supplier_sku is null));

alter table public.job_materials
  drop constraint job_materials_name_check,
  add constraint job_materials_name_check check (char_length(name) between 2 and 200);

drop index public.products_name_unique;
create unique index products_own_name_unique on public.products (lower(name)) where source is null;
create unique index products_source_sku_unique on public.products (source, supplier_sku) where source is not null;
create index products_name_trgm on public.products using gin (lower(name) extensions.gin_trgm_ops);
create index products_sku_prefix on public.products (lower(supplier_sku) text_pattern_ops);
create index job_materials_product on public.job_materials (product_id);

comment on column public.products.source is 'null = Dad''s own product; else the supplier catalogue it came from (e.g. goodwins).';
comment on column public.products.price_cents is 'Usual price each in cents; for a catalogue product the supplier''s VAT-inclusive price unless staff changed it.';
comment on column public.products.supplier_price_cents is 'The supplier''s VAT-inclusive price at the last import.';
comment on column public.products.price_edited_at is 'Staff changed a catalogue product''s price; imports keep it.';

-- LIKE pattern text from user input: \, % and _ escaped.
create function private.like_escape(p text)
returns text
language sql
immutable
set search_path = ''
as $$
  select replace(replace(replace(coalesce(p, ''), '\', '\\'), '%', '\%'), '_', '\_')
$$;
revoke all on function private.like_escape(text) from public, anon, authenticated;

-- Own products only: one per name in any case.
create or replace function public.add_product(p_name text, p_unit text, p_price_cents integer, p_supplier text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := private.tidy(p_name);
  v_unit text := coalesce(private.tidy(p_unit), 'each');
  v_supplier text := private.tidy(p_supplier);
  v_id uuid;
begin
  perform private.plan_actor();
  if v_name is null or char_length(v_name) not between 2 and 200 or char_length(v_unit) > 20
     or p_price_cents is null or p_price_cents not between 0 and 100000000
     or char_length(coalesce(v_supplier, '')) > 80 then
    raise exception 'product' using errcode = '22023';
  end if;
  select id into v_id from public.products
  where source is null and lower(name) = lower(v_name) for update;
  if found then
    update public.products set archived_at = null where id = v_id;
    return v_id;
  end if;
  insert into public.products (name, unit, price_cents, supplier, created_by)
  values (v_name, v_unit, p_price_cents, v_supplier, (select auth.uid()))
  returning id into v_id;
  return v_id;
end;
$$;

-- A changed price on a catalogue product is remembered, so imports keep it.
create or replace function public.update_product(p_id uuid, p_name text, p_unit text, p_price_cents integer, p_supplier text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := private.tidy(p_name);
  v_unit text := coalesce(private.tidy(p_unit), 'each');
  v_supplier text := private.tidy(p_supplier);
  v_row public.products;
begin
  perform private.plan_actor();
  if v_name is null or char_length(v_name) not between 2 and 200 or char_length(v_unit) > 20
     or p_price_cents is null or p_price_cents not between 0 and 100000000
     or char_length(coalesce(v_supplier, '')) > 80 then
    raise exception 'product' using errcode = '22023';
  end if;
  select * into v_row from public.products where id = p_id for update;
  if not found then
    raise exception 'product not found' using errcode = 'P0002';
  end if;
  update public.products
  set name = v_name, unit = v_unit, price_cents = p_price_cents, supplier = v_supplier, updated_at = now(),
      price_edited_at = case
        when v_row.source is not null and p_price_cents <> v_row.price_cents then now()
        else v_row.price_edited_at end
  where id = p_id;
end;
$$;

-- Search and browse (staff). p_filter: 'all', 'mine', 'used', 'mine_used' or a source slug.
-- Every word of p_query must be in the name (any order) or start the SKU. Order: used on a job
-- first, then own, then catalogue; within each, the exact name, then names starting with the
-- query, then a word starting with the first word, then the rest by name.
create function public.find_products(
  p_query text default '',
  p_filter text default 'all',
  p_limit integer default 20,
  p_offset integer default 0,
  p_archived boolean default false
)
returns table (
  id uuid, name text, unit text, price_cents integer, supplier text, archived_at timestamptz,
  source text, supplier_sku text, source_url text, category text, supplier_price_cents integer,
  price_edited_at timestamptz, price_checked_at timestamptz, uses bigint, total bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_q text := lower(private.tidy(p_query));
  v_words text[] := '{}';
  v_first text;
begin
  if not public.is_staff() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_limit is null or p_limit not between 1 and 100 or p_offset is null or p_offset < 0
     or p_filter is null
     or (p_filter not in ('all', 'mine', 'used', 'mine_used') and p_filter !~ '^[a-z][a-z0-9-]{1,30}$')
     or char_length(coalesce(v_q, '')) > 100 then
    raise exception 'search' using errcode = '22023';
  end if;
  if v_q is not null then
    v_words := (regexp_split_to_array(v_q, ' '))[1:8];
    v_first := private.like_escape(v_words[1]);
  end if;
  return query
  with used as (
    select m.product_id, count(*) as n from public.job_materials m
    where m.product_id is not null group by m.product_id
  ), hits as (
    select p.*, coalesce(u.n, 0) as uses,
      case
        when v_q is null then 3
        when lower(p.name) = v_q or lower(p.supplier_sku) = v_q then 0
        when lower(p.name) like private.like_escape(v_q) || '%' then 1
        when (' ' || lower(p.name)) like '% ' || v_first || '%' then 2
        else 3
      end as rank
    from public.products p
    left join used u on u.product_id = p.id
    where (p_archived or p.archived_at is null)
      and (v_q is null
        or ((lower(p.name) like '%' || v_first || '%' or lower(p.supplier_sku) like v_first || '%')
          and not exists (
            select 1 from unnest(v_words) w
            where not (lower(p.name) like '%' || private.like_escape(w) || '%'
                       or lower(coalesce(p.supplier_sku, '')) like private.like_escape(w) || '%'))))
  )
  select h.id, h.name, h.unit, h.price_cents, h.supplier, h.archived_at, h.source, h.supplier_sku,
    h.source_url, h.category, h.supplier_price_cents, h.price_edited_at, h.price_checked_at,
    h.uses, count(*) over () as total
  from hits h
  where case p_filter
    when 'all' then true
    when 'mine' then h.source is null
    when 'used' then h.uses > 0
    when 'mine_used' then h.source is null or h.uses > 0
    else h.source = p_filter
  end
  order by (h.uses > 0) desc, (h.source is null) desc, h.rank, (h.archived_at is not null), lower(h.name), h.id
  limit p_limit offset p_offset;
end;
$$;
revoke all on function public.find_products(text, text, integer, integer, boolean) from public, anon, authenticated;
grant execute on function public.find_products(text, text, integer, integer, boolean) to authenticated;

-- The import (scripts/products-import.mts, service role only): one batch of catalogue rows
-- [{sku, name, price_cents, url, category}], upserted by (source, sku). New rows are added; known
-- ones get the new name, page, category and supplier price, and the usual price unless staff
-- changed it; price_checked_at is set on every row seen. Archived rows stay archived. With
-- p_dry_run nothing is written and the counts say what would happen.
create function public.import_supplier_products(
  p_source text,
  p_supplier text,
  p_rows jsonb,
  p_dry_run boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_supplier text := private.tidy(p_supplier);
  v_row record;
  v_old public.products;
  v_name text;
  v_sku text;
  v_cat text;
  v_url text;
  v_added integer := 0;
  v_updated integer := 0;
  v_unchanged integer := 0;
  v_kept integer := 0;
  v_invalid integer := 0;
  v_at timestamptz := now();
begin
  if p_source is null or p_source !~ '^[a-z][a-z0-9-]{1,30}$' or v_supplier is null
     or char_length(v_supplier) > 80 or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 1000 then
    raise exception 'import' using errcode = '22023';
  end if;
  for v_row in
    select * from jsonb_to_recordset(p_rows) as x(sku text, name text, price_cents integer, url text, category text)
  loop
    v_name := private.tidy(v_row.name);
    v_sku := private.tidy(v_row.sku);
    v_cat := private.tidy(v_row.category);
    v_url := btrim(coalesce(v_row.url, ''));
    if v_name is null or char_length(v_name) not between 2 and 200 or v_sku is null or char_length(v_sku) > 60
       or v_row.price_cents is null or v_row.price_cents not between 1 and 100000000
       or (v_url <> '' and (v_url !~ '^https://' or char_length(v_url) > 500))
       or char_length(coalesce(v_cat, '')) > 200 then
      v_invalid := v_invalid + 1;
      continue;
    end if;
    select * into v_old from public.products where source = p_source and supplier_sku = v_sku for update;
    if not found then
      v_added := v_added + 1;
      if not p_dry_run then
        insert into public.products (name, unit, price_cents, supplier, source, supplier_sku, source_url,
          category, price_checked_at, supplier_price_cents)
        values (v_name, 'each', v_row.price_cents, v_supplier, p_source, v_sku, nullif(v_url, ''),
          v_cat, v_at, v_row.price_cents);
      end if;
      continue;
    end if;
    if v_old.price_edited_at is not null and v_old.price_cents <> v_row.price_cents then
      v_kept := v_kept + 1;
    end if;
    if v_old.name = v_name and v_old.source_url is not distinct from nullif(v_url, '')
       and v_old.category is not distinct from v_cat
       and v_old.supplier_price_cents is not distinct from v_row.price_cents
       and (v_old.price_edited_at is not null or v_old.price_cents = v_row.price_cents) then
      v_unchanged := v_unchanged + 1;
    else
      v_updated := v_updated + 1;
    end if;
    if not p_dry_run then
      update public.products
      set name = v_name, source_url = nullif(v_url, ''), category = v_cat, supplier = v_supplier,
          supplier_price_cents = v_row.price_cents, price_checked_at = v_at,
          price_cents = case when price_edited_at is null then v_row.price_cents else price_cents end,
          updated_at = case when price_edited_at is null and price_cents <> v_row.price_cents then v_at else updated_at end
      where id = v_old.id;
    end if;
  end loop;
  return jsonb_build_object('added', v_added, 'updated', v_updated, 'unchanged', v_unchanged,
    'kept_your_price', v_kept, 'invalid', v_invalid, 'dry_run', p_dry_run);
end;
$$;
revoke all on function public.import_supplier_products(text, text, jsonb, boolean) from public, anon, authenticated;
grant execute on function public.import_supplier_products(text, text, jsonb, boolean) to service_role;
