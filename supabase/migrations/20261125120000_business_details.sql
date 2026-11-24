-- Slice 5, part 2: business details in the database, edited by an admin, read by the public pages
-- through one function that exposes only public fields. Unset values are NULL and are not shown.

create table public.business_details (
  id boolean primary key default true check (id),
  trading_name text not null default 'Q3 Interiors' check (char_length(trading_name) between 1 and 80),
  legal_name text check (legal_name is null or char_length(legal_name) between 2 and 160),
  postal_address text check (postal_address is null or char_length(postal_address) between 5 and 300),
  contact_phone text check (contact_phone is null or (char_length(contact_phone) between 5 and 40
    and contact_phone ~ '^[0-9+() .-]+$')),
  contact_email text check (contact_email is null or (char_length(contact_email) <= 254
    and contact_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  service_area text check (service_area is null or char_length(service_area) between 2 and 200),
  privacy_contact text check (privacy_contact is null or char_length(privacy_contact) between 5 and 254),
  -- Set by an admin once the privacy notice has been read and the legal details are in; removes
  -- the "Draft" marker from the public notice.
  privacy_reviewed_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint privacy_review_needs_details check (privacy_reviewed_at is null
    or (legal_name is not null and postal_address is not null and privacy_contact is not null))
);

comment on table public.business_details is
  'Customer-facing business details (one row). NULL means not confirmed yet and is never shown.';

-- The phone customers were asked to ring moves here from booking_settings (which keeps its old
-- column until the functions no longer read it; dropped in a later migration).
insert into public.business_details (contact_phone)
select business_phone from public.booking_settings limit 1;
insert into public.business_details (id) values (true) on conflict do nothing;

revoke all on table public.business_details from public, anon, authenticated;
grant select on table public.business_details to authenticated;
grant update (trading_name, legal_name, postal_address, contact_phone, contact_email, service_area,
              privacy_contact, privacy_reviewed_at, updated_at)
  on public.business_details to authenticated;
grant select, insert, update, delete on table public.business_details to service_role;
alter table public.business_details enable row level security;
create policy "staff read business details" on public.business_details
  for select to authenticated using ((select public.is_staff()));
create policy "admins edit business details" on public.business_details
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

-- The only public read: these fields and nothing else.
create function public.public_business_details()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'trading_name', trading_name,
    'legal_name', legal_name,
    'postal_address', postal_address,
    'contact_phone', contact_phone,
    'contact_email', contact_email,
    'service_area', service_area,
    'privacy_contact', privacy_contact,
    'privacy_reviewed', privacy_reviewed_at is not null,
    -- The privacy notice states the retention period once an admin has set one.
    'retention_months', (select retention_months from public.booking_settings limit 1))
  from public.business_details
  limit 1;
$$;

revoke all on function public.public_business_details() from public, anon, authenticated;
grant execute on function public.public_business_details() to anon, authenticated, service_role;
