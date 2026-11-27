-- The estimate form's tick-list of the work looked at, by job type, that learns new items.
--
-- estimate_work_items holds the offered items: a label and the project type it belongs to (the
-- enquiry form's stable option value, e.g. 'kitchen'; null means "any job"). Staff add one from
-- the form ("Add another") and remove one ("Edit list", which archives it). An estimate keeps the
-- ticked labels as a snapshot (estimates.work_items), so later edits to the list never change it;
-- work_looked_at becomes the optional "Anything else" note.

create table public.estimate_work_items (
  id uuid primary key default gen_random_uuid(),
  label text not null check (char_length(label) between 2 and 60 and label = btrim(label)),
  -- The project type's option value (stable across form versions); null = offered for any job.
  project_type text check (project_type is null or project_type ~ '^[a-z][a-z0-9_]{0,39}$'),
  archived_at timestamptz,
  created_by uuid references public.staff (user_id) on delete set null,
  created_at timestamptz not null default now()
);

-- One label per project type, whatever its case ("any job" counts as one type).
create unique index estimate_work_items_unique
  on public.estimate_work_items (coalesce(project_type, ''), lower(label));

comment on table public.estimate_work_items is
  'Work items offered on the estimate form, by project type (null = any job). Staff only.';

revoke all on table public.estimate_work_items from public, anon, authenticated;
grant select on table public.estimate_work_items to authenticated;
grant select, insert, update, delete on table public.estimate_work_items to service_role;
alter table public.estimate_work_items enable row level security;
create policy "staff read work items" on public.estimate_work_items
  for select to authenticated using ((select public.is_staff()));
-- Writes only through add_estimate_work_item and archive_estimate_work_item.

insert into public.estimate_work_items (project_type, label)
select t, l
from (values
  ('kitchen', array['Strip out the old kitchen', 'New units and worktop', 'Appliances fitted',
    'Splashback tiling', 'Tiled floor', 'Plumbing', 'Electrics and lighting', 'Plastering',
    'Painting']),
  ('bathroom', array['Strip out the old bathroom', 'Plumbing', 'Electrics and extractor fan',
    'Wall tiling', 'Floor tiling', 'Shower', 'Bath', 'Toilet and basin', 'Vanity unit and mirror',
    'Painting']),
  ('extension', array['Foundations', 'Walls and structure', 'Roof', 'Windows and doors',
    'Insulation', 'Plumbing', 'Electrics', 'Plastering', 'Flooring', 'Painting']),
  ('attic', array['Structural work', 'Stairs', 'Roof windows', 'Insulation', 'Electrics',
    'Plastering', 'Flooring', 'Painting']),
  ('workplace', array['Partition walls', 'Ceilings', 'Electrics and data', 'Fire system',
    'Emergency lighting', 'Bathrooms', 'Flooring', 'Painting']),
  (null, array['Strip out', 'Subfloor and joists', 'Flooring', 'Tiling', 'Plumbing', 'Rewire',
    'Plastering and skim', 'Carpentry and skirting', 'Doors', 'Painting', 'Waste removal',
    'Site toilet'])
) seed(t, labels)
cross join lateral unnest(labels) with ordinality u(l, n)
order by t nulls last, n;

-- The list keeps the seed order: created_at ties are broken by this insert order.
alter table public.estimate_work_items add column position bigint generated always as identity;

-- Staff: add an item (or bring an archived one back) for a project type; returns its id.
create function public.add_estimate_work_item(p_project_type text, p_label text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_label text := regexp_replace(btrim(coalesce(p_label, ''), E' \t\r\n'), '\s+', ' ', 'g');
  v_type text := nullif(btrim(coalesce(p_project_type, '')), '');
  v_id uuid;
begin
  if not public.is_staff() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if char_length(v_label) not between 2 and 60 then
    raise exception 'label' using errcode = '22023';
  end if;
  if v_type is not null and v_type !~ '^[a-z][a-z0-9_]{0,39}$' then
    raise exception 'project type' using errcode = '22023';
  end if;
  select id into v_id from public.estimate_work_items
  where coalesce(project_type, '') = coalesce(v_type, '') and lower(label) = lower(v_label)
  for update;
  if found then
    update public.estimate_work_items set archived_at = null where id = v_id;
    return v_id;
  end if;
  insert into public.estimate_work_items (project_type, label, created_by)
  values (v_type, v_label, (select auth.uid()))
  returning id into v_id;
  return v_id;
end;
$$;

-- Staff: stop offering an item. Past estimates keep their own copy of the label.
create function public.archive_estimate_work_item(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_staff() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  update public.estimate_work_items set archived_at = coalesce(archived_at, now()) where id = p_id;
  if not found then
    raise exception 'item not found' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.add_estimate_work_item(text, text), public.archive_estimate_work_item(uuid)
  from public, anon, authenticated;
grant execute on function public.add_estimate_work_item(text, text), public.archive_estimate_work_item(uuid)
  to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Estimates: the ticked items as sent, and the note now optional
-- ---------------------------------------------------------------------------------------------

alter table public.estimates
  add column work_items text[] not null default '{}'
    check (cardinality(work_items) <= 40 and array_position(work_items, null) is null),
  alter column work_looked_at drop not null,
  drop constraint estimates_work_looked_at_check,
  add constraint estimates_work_looked_at_check
    check (work_looked_at is null or char_length(work_looked_at) between 1 and 600),
  add constraint estimates_work_check check (cardinality(work_items) > 0 or work_looked_at is not null);

comment on column public.estimates.work_items is 'The ticked work items, in the order shown, as sent.';
comment on column public.estimates.work_looked_at is 'The optional "Anything else" note, as sent.';

-- send_estimate gains the items (defaulted, so a console loaded before this still sends).
drop function public.send_estimate(uuid, integer, numeric, text);

create function public.send_estimate(
  p_booking_id uuid,
  p_price integer,
  p_percent numeric,
  p_work text,
  p_items text[] default '{}'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_booking public.bookings;
  v_mode text;
  v_email text;
  v_name text;
  v_note text := nullif(btrim(coalesce(p_work, ''), E' \t\r\n'), '');
  v_items text[] := '{}';
  v_item text;
  v_caveats text;
  v_low integer;
  v_high integer;
  v_id uuid;
  v_at timestamptz := now();
begin
  if not public.is_staff() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_price is null or p_price not between 100 and 10000000 then
    raise exception 'price' using errcode = '22023';
  end if;
  if p_percent is null or p_percent not between 0 and 30 or (p_percent * 2) <> trunc(p_percent * 2) then
    raise exception 'percent' using errcode = '22023';
  end if;
  -- Items: trimmed, 2 to 60 characters, no repeats (any case), at most 40, in the order given.
  if cardinality(coalesce(p_items, '{}')) > 40 then
    raise exception 'work items' using errcode = '22023';
  end if;
  foreach v_item in array coalesce(p_items, '{}') loop
    v_item := regexp_replace(btrim(coalesce(v_item, ''), E' \t\r\n'), '\s+', ' ', 'g');
    if char_length(v_item) not between 2 and 60
       or exists (select 1 from unnest(v_items) x where lower(x) = lower(v_item)) then
      raise exception 'work items' using errcode = '22023';
    end if;
    v_items := v_items || v_item;
  end loop;
  if v_note is not null and char_length(v_note) > 600 then
    raise exception 'work looked at' using errcode = '22023';
  end if;
  if cardinality(v_items) = 0 and v_note is null then
    raise exception 'work looked at' using errcode = '22023';
  end if;

  select b.* into v_booking from public.bookings b where b.id = p_booking_id for update;
  if not found then
    raise exception 'appointment not found' using errcode = 'P0002';
  end if;
  select t.mode into v_mode from public.appointment_types t where t.id = v_booking.appointment_type_id;
  if v_mode is distinct from 'on_site' then
    raise exception 'site visits only' using errcode = '22023';
  end if;
  if v_booking.state <> 'confirmed' then
    raise exception 'appointment not confirmed' using errcode = '22023';
  end if;

  select nullif(btrim(e.answers ->> 'email'), '') into v_email
  from public.enquiries e where e.id = v_booking.enquiry_id for update;
  if v_email is null then
    raise exception 'no email address' using errcode = '22023';
  end if;

  select display_name into v_name from public.staff where user_id = (select auth.uid());
  select r.low, r.high into v_low, v_high from private.estimate_range(p_price, p_percent) r;
  v_caveats := coalesce(
    nullif(btrim((select body from public.message_blocks where key = 'estimate_caveats')), ''),
    private.estimate_caveats_default());

  insert into public.estimates (enquiry_id, booking_id, price_eur, plus_minus_percent, low_eur,
    high_eur, work_items, work_looked_at, caveats, sent_at, valid_until, created_by, created_by_name)
  values (v_booking.enquiry_id, v_booking.id, p_price, p_percent, v_low, v_high, v_items, v_note,
    v_caveats, v_at, v_at + interval '10 days', (select auth.uid()), v_name)
  returning id into v_id;

  insert into public.enquiry_events (enquiry_id, kind, booking_id, detail, actor_user_id, actor_name)
  values (v_booking.enquiry_id, 'estimate_sent', v_booking.id,
    format('€%s to €%s (price €%s, plus or minus %s%%)',
      to_char(v_low, 'FM999,999,999'), to_char(v_high, 'FM999,999,999'),
      to_char(p_price, 'FM999,999,999'), trim_scale(p_percent)),
    (select auth.uid()), v_name);

  insert into public.communications (enquiry_id, booking_id, estimate_id, template, recipient, dedupe_key)
  values (v_booking.enquiry_id, v_booking.id, v_id, 'estimate', v_email, 'estimate:' || v_id);

  update public.enquiries set updated_at = now() where id = v_booking.enquiry_id;
  return v_id;
end;
$$;

revoke all on function public.send_estimate(uuid, integer, numeric, text, text[]) from public, anon, authenticated;
grant execute on function public.send_estimate(uuid, integer, numeric, text, text[]) to authenticated;
