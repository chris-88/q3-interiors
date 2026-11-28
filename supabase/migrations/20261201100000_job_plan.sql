-- The job plan, slice 1 (2026-11-28; vault brief q3-job-plan-slice-1-brief): Dad's notebook in the
-- app. A won enquiry (the job) gets stages, each with the materials it needs and a tradesperson;
-- materials come from a product list that grows as he types and keeps a usual price. A job keeps
-- the price it was planned at: each line snapshots the product's name, unit and price, so changing
-- a usual price later changes future lines only.
--
-- Staff only: RLS lets active staff read; every write goes through a security-definer function
-- below that checks is_staff(). Nothing for anon (the five public functions stay five). A plan
-- hangs off the enquiry and goes with it (on delete cascade), so the data-request delete and the
-- retention job (both private.delete_enquiry_data) remove it.
--
-- Stage templates are seeded only; there is no screen to edit them yet. Money is in cents; the
-- price is "price each", entered as paid, with no VAT claim (an open question with Chris).
--
-- The kind list repeats every kind up to 20261129200000_staff_book_call and adds two.

alter table public.enquiry_events drop constraint enquiry_events_kind_check;
alter table public.enquiry_events
  add constraint enquiry_events_kind_check check (kind in (
    'submitted', 'status_changed', 'site_details_added', 'contact_requested',
    'booking_requested', 'booking_confirmed', 'booking_failed', 'booking_retrying',
    'email_sent', 'email_failed',
    'booking_cancelled', 'booking_rescheduled', 'calendar_updated', 'calendar_update_failed',
    'attendance_recorded', 'outcome_recorded', 'outcome_cleared',
    'details_updated', 'prepare_updated', 'photo_added', 'photo_removed',
    'chase_flagged', 'chase_updated', 'chase_cleared',
    'note_added',
    'estimate_sent', 'quote_requested',
    'call_held_early', 'visit_link_sent', 'visit_booked_by_staff',
    'quote_sent', 'quote_change_requested',
    'call_booked_by_staff',
    'plan_started', 'stage_done'
  ));

-- ---------------------------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------------------------

create table public.tradespeople (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80 and name = btrim(name)),
  trade text check (trade is null or (char_length(trade) between 1 and 60 and trade = btrim(trade))),
  phone text check (phone is null or (char_length(phone) between 1 and 30 and phone = btrim(phone))),
  archived_at timestamptz,
  created_by uuid references public.staff (user_id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index tradespeople_name_unique on public.tradespeople (lower(name));
comment on table public.tradespeople is
  'Tradespeople a stage can be given to. Not users; nothing is sent to them. Staff only.';

create table public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 80 and name = btrim(name)),
  unit text not null default 'each' check (char_length(unit) between 1 and 20 and unit = btrim(unit)),
  price_cents integer not null check (price_cents between 0 and 100000000),
  supplier text check (supplier is null or (char_length(supplier) between 1 and 80 and supplier = btrim(supplier))),
  archived_at timestamptz,
  created_by uuid references public.staff (user_id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index products_name_unique on public.products (lower(name));
comment on table public.products is
  'The product list: name, unit and usual price each (cents). Lines snapshot it. Staff only.';

create table public.stage_templates (
  id uuid primary key default gen_random_uuid(),
  -- The enquiry form's project type option value; null = any job.
  project_type text check (project_type is null or project_type ~ '^[a-z][a-z0-9_]{0,39}$'),
  name text not null check (char_length(name) between 1 and 60 and name = btrim(name)),
  position bigint generated always as identity
);
comment on table public.stage_templates is
  'The stages a new plan starts with, by job type (null = any job). Seeded; staff read only.';

create table public.job_stages (
  id uuid primary key default gen_random_uuid(),
  enquiry_id uuid not null references public.enquiries (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60 and name = btrim(name)),
  position integer not null,
  done_at timestamptz,
  tradesperson_id uuid references public.tradespeople (id) on delete set null,
  created_at timestamptz not null default now()
);
create index job_stages_enquiry on public.job_stages (enquiry_id, position);

create table public.job_materials (
  id uuid primary key default gen_random_uuid(),
  enquiry_id uuid not null references public.enquiries (id) on delete cascade,
  stage_id uuid not null references public.job_stages (id) on delete cascade,
  product_id uuid references public.products (id) on delete set null,
  -- Snapshots: the line keeps what was planned, whatever the product list says later.
  name text not null check (char_length(name) between 2 and 80),
  quantity numeric(12, 3) not null check (quantity > 0 and quantity <= 100000),
  unit text not null check (char_length(unit) between 1 and 20 and unit = btrim(unit)),
  price_cents integer not null check (price_cents between 0 and 100000000),
  got_at timestamptz,
  position bigint generated always as identity,
  created_at timestamptz not null default now()
);
create index job_materials_enquiry on public.job_materials (enquiry_id);
create index job_materials_stage on public.job_materials (stage_id);

do $$
declare t text;
begin
  foreach t in array array['tradespeople', 'products', 'stage_templates', 'job_stages', 'job_materials'] loop
    execute format('revoke all on table public.%I from public, anon, authenticated', t);
    execute format('grant select on table public.%I to authenticated', t);
    execute format('grant select, insert, update, delete on table public.%I to service_role', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "staff read" on public.%I for select to authenticated using ((select public.is_staff()))', t);
  end loop;
end;
$$;

insert into public.stage_templates (project_type, name)
select t, n
from (values
  ('kitchen', array['Strip out', 'First fix plumbing and electrics', 'Plastering', 'Units and worktop',
    'Tiling', 'Second fix', 'Painting and finish']),
  ('bathroom', array['Strip out', 'First fix plumbing', 'First fix electrics', 'Plastering and boarding',
    'Tiling', 'Sanitaryware', 'Second fix', 'Painting and finish']),
  ('extension', array['Groundworks and foundations', 'Walls', 'Roof', 'Windows and doors', 'First fix',
    'Insulation and plastering', 'Floors', 'Second fix', 'Decoration']),
  ('attic', array['Structure and floor', 'Stairs', 'Roof windows', 'First fix', 'Insulation and plastering',
    'Second fix', 'Decoration']),
  ('workplace', array['Strip out', 'Partitions and ceilings', 'First fix electrics and data',
    'Fire and emergency lighting', 'Floors', 'Second fix', 'Decoration']),
  (null, array['Strip out', 'First fix', 'Plastering', 'Finishes', 'Second fix', 'Painting and snagging'])
) seed(t, names)
cross join lateral unnest(names) with ordinality u(n, k)
order by t nulls last, k;

-- ---------------------------------------------------------------------------------------------
-- Write path (active staff only)
-- ---------------------------------------------------------------------------------------------

-- The caller's name for the history, or "not allowed".
create function private.plan_actor()
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_name text;
begin
  if not public.is_staff() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select display_name into v_name from public.staff where user_id = (select auth.uid());
  return v_name;
end;
$$;
revoke all on function private.plan_actor() from public, anon, authenticated;

-- Tidy free text: trim and collapse spaces; null when empty.
create function private.tidy(p text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(regexp_replace(btrim(coalesce(p, ''), E' \t\r\n'), '\s+', ' ', 'g'), '')
$$;
revoke all on function private.tidy(text) from public, anon, authenticated;

-- Start the plan of a won job from the template for its job type (else the any-job list).
-- Returns the number of stages; a plan already started is left as it is.
create function public.start_job_plan(p_enquiry_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := private.plan_actor();
  v_type text;
  v_outcome text;
  v_count integer;
begin
  select e.outcome, e.answers ->> 'project_type' into v_outcome, v_type
  from public.enquiries e where e.id = p_enquiry_id for update;
  if not found then
    raise exception 'enquiry not found' using errcode = 'P0002';
  end if;
  if v_outcome is distinct from 'won' then
    raise exception 'job not won' using errcode = '22023';
  end if;
  select count(*) into v_count from public.job_stages where enquiry_id = p_enquiry_id;
  if v_count > 0 then
    return v_count;
  end if;
  if not exists (select 1 from public.stage_templates where project_type = v_type) then
    v_type := null;
  end if;
  insert into public.job_stages (enquiry_id, name, position)
  select p_enquiry_id, t.name, row_number() over (order by t.position)
  from public.stage_templates t
  where t.project_type is not distinct from v_type;
  get diagnostics v_count = row_count;
  insert into public.enquiry_events (enquiry_id, kind, detail, actor_user_id, actor_name)
  values (p_enquiry_id, 'plan_started', format('%s stages', v_count), (select auth.uid()), v_name);
  return v_count;
end;
$$;

create function public.add_job_stage(p_enquiry_id uuid, p_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := private.tidy(p_name);
  v_id uuid;
begin
  perform private.plan_actor();
  if v_name is null or char_length(v_name) > 60 then
    raise exception 'stage name' using errcode = '22023';
  end if;
  perform 1 from public.enquiries where id = p_enquiry_id and outcome = 'won' for update;
  if not found then
    raise exception 'job not won' using errcode = '22023';
  end if;
  insert into public.job_stages (enquiry_id, name, position)
  values (p_enquiry_id, v_name,
    coalesce((select max(position) from public.job_stages where enquiry_id = p_enquiry_id), 0) + 1)
  returning id into v_id;
  return v_id;
end;
$$;

create function public.rename_job_stage(p_stage_id uuid, p_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_name text := private.tidy(p_name);
begin
  perform private.plan_actor();
  if v_name is null or char_length(v_name) > 60 then
    raise exception 'stage name' using errcode = '22023';
  end if;
  update public.job_stages set name = v_name where id = p_stage_id;
  if not found then
    raise exception 'stage not found' using errcode = 'P0002';
  end if;
end;
$$;

-- Move a stage one place up (-1) or down (1); at either end nothing moves.
create function public.move_job_stage(p_stage_id uuid, p_by integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_stage public.job_stages;
  v_other public.job_stages;
begin
  perform private.plan_actor();
  if p_by not in (-1, 1) then
    raise exception 'move' using errcode = '22023';
  end if;
  select * into v_stage from public.job_stages where id = p_stage_id for update;
  if not found then
    raise exception 'stage not found' using errcode = 'P0002';
  end if;
  select * into v_other from public.job_stages
  where enquiry_id = v_stage.enquiry_id
    and (case when p_by < 0 then position < v_stage.position else position > v_stage.position end)
  order by case when p_by < 0 then -position else position end
  limit 1
  for update;
  if not found then
    return;
  end if;
  update public.job_stages set position = v_other.position where id = v_stage.id;
  update public.job_stages set position = v_stage.position where id = v_other.id;
end;
$$;

-- Remove a stage and its material lines.
create function public.remove_job_stage(p_stage_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.plan_actor();
  delete from public.job_stages where id = p_stage_id;
  if not found then
    raise exception 'stage not found' using errcode = 'P0002';
  end if;
end;
$$;

create function public.set_job_stage_done(p_stage_id uuid, p_done boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := private.plan_actor();
  v_stage public.job_stages;
begin
  select * into v_stage from public.job_stages where id = p_stage_id for update;
  if not found then
    raise exception 'stage not found' using errcode = 'P0002';
  end if;
  if p_done and v_stage.done_at is null then
    update public.job_stages set done_at = now() where id = p_stage_id;
    insert into public.enquiry_events (enquiry_id, kind, detail, actor_user_id, actor_name)
    values (v_stage.enquiry_id, 'stage_done', format('%s done', v_stage.name), (select auth.uid()), v_name);
  elsif not p_done then
    update public.job_stages set done_at = null where id = p_stage_id;
  end if;
end;
$$;

create function public.set_job_stage_tradesperson(p_stage_id uuid, p_tradesperson_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.plan_actor();
  if p_tradesperson_id is not null
     and not exists (select 1 from public.tradespeople where id = p_tradesperson_id) then
    raise exception 'tradesperson not found' using errcode = 'P0002';
  end if;
  update public.job_stages set tradesperson_id = p_tradesperson_id where id = p_stage_id;
  if not found then
    raise exception 'stage not found' using errcode = 'P0002';
  end if;
end;
$$;

-- Tradespeople: one per name (any case); adding a name again returns that person (back in the list).
create function public.add_tradesperson(p_name text, p_trade text, p_phone text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := private.tidy(p_name);
  v_trade text := private.tidy(p_trade);
  v_phone text := private.tidy(p_phone);
  v_id uuid;
begin
  perform private.plan_actor();
  if v_name is null or char_length(v_name) > 80 or char_length(coalesce(v_trade, '')) > 60
     or char_length(coalesce(v_phone, '')) > 30 then
    raise exception 'tradesperson' using errcode = '22023';
  end if;
  select id into v_id from public.tradespeople where lower(name) = lower(v_name) for update;
  if found then
    update public.tradespeople
    set archived_at = null, trade = coalesce(v_trade, trade), phone = coalesce(v_phone, phone)
    where id = v_id;
    return v_id;
  end if;
  insert into public.tradespeople (name, trade, phone, created_by)
  values (v_name, v_trade, v_phone, (select auth.uid()))
  returning id into v_id;
  return v_id;
end;
$$;

create function public.update_tradesperson(p_id uuid, p_name text, p_trade text, p_phone text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := private.tidy(p_name);
  v_trade text := private.tidy(p_trade);
  v_phone text := private.tidy(p_phone);
begin
  perform private.plan_actor();
  if v_name is null or char_length(v_name) > 80 or char_length(coalesce(v_trade, '')) > 60
     or char_length(coalesce(v_phone, '')) > 30 then
    raise exception 'tradesperson' using errcode = '22023';
  end if;
  update public.tradespeople set name = v_name, trade = v_trade, phone = v_phone where id = p_id;
  if not found then
    raise exception 'tradesperson not found' using errcode = 'P0002';
  end if;
end;
$$;

-- Archive (or bring back) a tradesperson. Stages keep whoever they were given.
create function public.archive_tradesperson(p_id uuid, p_archived boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.plan_actor();
  update public.tradespeople
  set archived_at = case when p_archived then coalesce(archived_at, now()) end
  where id = p_id;
  if not found then
    raise exception 'tradesperson not found' using errcode = 'P0002';
  end if;
end;
$$;

-- Products: one per name (any case); adding a name again returns it (back in the list, price kept).
create function public.add_product(p_name text, p_unit text, p_price_cents integer, p_supplier text)
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
  if v_name is null or char_length(v_name) not between 2 and 80 or char_length(v_unit) > 20
     or p_price_cents is null or p_price_cents not between 0 and 100000000
     or char_length(coalesce(v_supplier, '')) > 80 then
    raise exception 'product' using errcode = '22023';
  end if;
  select id into v_id from public.products where lower(name) = lower(v_name) for update;
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

-- Change a product. Lines already on a job keep the name, unit and price they were planned with.
create function public.update_product(p_id uuid, p_name text, p_unit text, p_price_cents integer, p_supplier text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := private.tidy(p_name);
  v_unit text := coalesce(private.tidy(p_unit), 'each');
  v_supplier text := private.tidy(p_supplier);
begin
  perform private.plan_actor();
  if v_name is null or char_length(v_name) not between 2 and 80 or char_length(v_unit) > 20
     or p_price_cents is null or p_price_cents not between 0 and 100000000
     or char_length(coalesce(v_supplier, '')) > 80 then
    raise exception 'product' using errcode = '22023';
  end if;
  update public.products
  set name = v_name, unit = v_unit, price_cents = p_price_cents, supplier = v_supplier, updated_at = now()
  where id = p_id;
  if not found then
    raise exception 'product not found' using errcode = 'P0002';
  end if;
end;
$$;

create function public.archive_product(p_id uuid, p_archived boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.plan_actor();
  update public.products
  set archived_at = case when p_archived then coalesce(archived_at, now()) end
  where id = p_id;
  if not found then
    raise exception 'product not found' using errcode = 'P0002';
  end if;
end;
$$;

-- Add a product to a stage. Quantity, unit and price default to 1, the product's unit and its
-- usual price; the line keeps them (and the name) as planned.
create function public.add_job_material(
  p_stage_id uuid,
  p_product_id uuid,
  p_quantity numeric default 1,
  p_unit text default null,
  p_price_cents integer default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_stage public.job_stages;
  v_product public.products;
  v_unit text;
  v_price integer;
  v_qty numeric := coalesce(p_quantity, 1);
  v_id uuid;
begin
  perform private.plan_actor();
  select * into v_stage from public.job_stages where id = p_stage_id;
  if not found then
    raise exception 'stage not found' using errcode = 'P0002';
  end if;
  select * into v_product from public.products where id = p_product_id;
  if not found then
    raise exception 'product not found' using errcode = 'P0002';
  end if;
  v_unit := coalesce(private.tidy(p_unit), v_product.unit);
  v_price := coalesce(p_price_cents, v_product.price_cents);
  if v_qty <= 0 or v_qty > 100000 or char_length(v_unit) > 20 or v_price not between 0 and 100000000 then
    raise exception 'line' using errcode = '22023';
  end if;
  insert into public.job_materials (enquiry_id, stage_id, product_id, name, quantity, unit, price_cents)
  values (v_stage.enquiry_id, v_stage.id, v_product.id, v_product.name, round(v_qty, 3), v_unit, v_price)
  returning id into v_id;
  return v_id;
end;
$$;

create function public.update_job_material(p_line_id uuid, p_quantity numeric, p_unit text, p_price_cents integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_unit text := private.tidy(p_unit);
begin
  perform private.plan_actor();
  if p_quantity is null or p_quantity <= 0 or p_quantity > 100000 or v_unit is null
     or char_length(v_unit) > 20 or p_price_cents is null or p_price_cents not between 0 and 100000000 then
    raise exception 'line' using errcode = '22023';
  end if;
  update public.job_materials
  set quantity = round(p_quantity, 3), unit = v_unit, price_cents = p_price_cents
  where id = p_line_id;
  if not found then
    raise exception 'line not found' using errcode = 'P0002';
  end if;
end;
$$;

create function public.set_job_material_got(p_line_id uuid, p_got boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.plan_actor();
  update public.job_materials
  set got_at = case when p_got then coalesce(got_at, now()) end
  where id = p_line_id;
  if not found then
    raise exception 'line not found' using errcode = 'P0002';
  end if;
end;
$$;

create function public.remove_job_material(p_line_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.plan_actor();
  delete from public.job_materials where id = p_line_id;
  if not found then
    raise exception 'line not found' using errcode = 'P0002';
  end if;
end;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.start_job_plan(uuid)', 'public.add_job_stage(uuid, text)',
    'public.rename_job_stage(uuid, text)', 'public.move_job_stage(uuid, integer)',
    'public.remove_job_stage(uuid)', 'public.set_job_stage_done(uuid, boolean)',
    'public.set_job_stage_tradesperson(uuid, uuid)',
    'public.add_tradesperson(text, text, text)', 'public.update_tradesperson(uuid, text, text, text)',
    'public.archive_tradesperson(uuid, boolean)',
    'public.add_product(text, text, integer, text)',
    'public.update_product(uuid, text, text, integer, text)', 'public.archive_product(uuid, boolean)',
    'public.add_job_material(uuid, uuid, numeric, text, integer)',
    'public.update_job_material(uuid, numeric, text, integer)',
    'public.set_job_material_got(uuid, boolean)', 'public.remove_job_material(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end;
$$;
