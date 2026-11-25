-- Enquiry form v2: the booking-first journey (landing choice -> Project -> Details -> Time).
--
-- The form itself is published by supabase/forms/published.sql (enquiry@2), applied by
-- scripts/db-migrate.sh after the migrations. This migration adds what the journey needs:
--
-- 1. A v2 site-visit enquiry carries its visit address in the answers (`site_street`,
--    `site_unit`, plus `location`). On save they are joined into the enquiry's site details
--    (the same `site_details` revision a v1 customer made on the booking page), so bookings,
--    emails and the calendar keep reading one place.
-- 2. `private.update_enquiry_details`: the time screen's editable line (the number to ring, the
--    visit address) and a change between call and visit after the save. Called only by the
--    public-booking function, as postgres, for the enquiry its token resolves to.
-- 3. `public.public_appointment_types()`: the landing page shows the live durations. Anon may run
--    it; it returns ids, modes and durations of active types only.

-- ---------------------------------------------------------------------------------------------
-- 1. Visit address from the answers
-- ---------------------------------------------------------------------------------------------

-- Keep in step with composeSiteAddress in src/forms/enquiry/v2.ts.
create function private.site_address_from_answers(p_answers jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(concat_ws(', ',
    nullif(btrim(p_answers ->> 'site_street'), ''),
    nullif(btrim(p_answers ->> 'site_unit'), ''),
    nullif(btrim(p_answers ->> 'location'), '')), '');
$$;

-- When the answers carry a street, make the site details match them (a new site_details
-- revision). Access notes already given are kept. A no-op when nothing changed.
create function private.sync_site_details_from_answers(p_enquiry_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_answers jsonb;
  v_site jsonb;
  v_address text;
begin
  select answers, site_details into v_answers, v_site from public.enquiries where id = p_enquiry_id;
  if not found or coalesce(btrim(v_answers ->> 'site_street'), '') = '' then
    return;
  end if;
  v_address := private.site_address_from_answers(v_answers);
  if v_site ->> 'site_address' is not distinct from v_address then
    return;
  end if;
  perform private.save_site_details(
    p_enquiry_id,
    jsonb_build_object('site_address', v_address)
      || case when v_site ? 'access_notes'
              then jsonb_build_object('access_notes', v_site -> 'access_notes')
              else '{}'::jsonb end);
end;
$$;

-- Same signature, grants and behaviour as before (limit, honeypot, alert, token); the one
-- addition is the site details sync for a v2 visit enquiry, inside the same transaction.
create or replace function public.submit_enquiry_with_access(
  p_idempotency_key uuid,
  p_form_id text,
  p_form_version integer,
  p_answers jsonb,
  p_marketing_opt_in boolean default false,
  p_attribution jsonb default null,
  -- A field people never see. Anything in it means a bot: answer normally, store nothing.
  p_trap text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reference text;
  v_id uuid;
  v_limit integer;
  c_alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
begin
  -- A retry of a saved enquiry is not a new submission: no limit, same reference.
  select id, reference into v_id, v_reference from public.enquiries where idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object('reference', v_reference) || private.mint_enquiry_token(v_id);
  end if;

  select enquiry_limit_per_hour into v_limit from public.booking_settings limit 1;
  if not private.rate_limit_take('enquiry', private.address_hash(private.request_address()),
                                 p_idempotency_key::text, coalesce(v_limit, 5)) then
    raise sqlstate 'PT429' using message = 'rate_limited',
      hint = 'Too many enquiries from this address. Please try again later.';
  end if;

  if nullif(btrim(coalesce(p_trap, '')), '') is not null then
    return jsonb_build_object(
      'reference', 'Q3-' || (
        select string_agg(substr(c_alphabet, 1 + floor(random() * length(c_alphabet))::integer, 1), '')
        from generate_series(1, 6)),
      'access_token', null,
      'expires_at', null);
  end if;

  v_reference := public.submit_enquiry(
    p_idempotency_key, p_form_id, p_form_version, p_answers, p_marketing_opt_in, p_attribution);
  select id into v_id from public.enquiries where idempotency_key = p_idempotency_key;
  perform private.sync_site_details_from_answers(v_id);
  perform private.queue_staff_alert(v_id, 'staff_new_enquiry');
  return jsonb_build_object('reference', v_reference) || private.mint_enquiry_token(v_id);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- 2. Changing details after the save
-- ---------------------------------------------------------------------------------------------

alter table public.enquiry_events drop constraint enquiry_events_kind_check;
alter table public.enquiry_events
  add constraint enquiry_events_kind_check check (kind in (
    'submitted', 'status_changed', 'site_details_added', 'contact_requested',
    'booking_requested', 'booking_confirmed', 'booking_failed', 'booking_retrying',
    'email_sent', 'email_failed',
    'booking_cancelled', 'booking_rescheduled', 'calendar_updated', 'calendar_update_failed',
    'attendance_recorded', 'outcome_recorded', 'outcome_cleared',
    'details_updated'
  ));

-- p_patch may hold only phone, appointment_preference, site_street and site_unit (strings).
-- Keys the enquiry's own form version knows are merged into its answers, re-validated against
-- that version, and stored as a new revision (with a 'details_updated' event naming the changed
-- questions). For a v1 enquiry, whose form has no address lines, a street goes straight into the
-- site details, joined with its location. Returns the enquiry's answers and visit address.
create function private.update_enquiry_details(p_enquiry_id uuid, p_patch jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_enquiry public.enquiries;
  v_schema jsonb;
  v_known text[];
  v_merge jsonb;
  v_clean jsonb;
  v_changed text;
  v_site jsonb;
begin
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' or p_patch = '{}'::jsonb then
    raise exception 'details must be a non-empty object' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_each(p_patch) as e
    where e.key not in ('phone', 'appointment_preference', 'site_street', 'site_unit')
       or jsonb_typeof(e.value) <> 'string'
  ) then
    raise exception 'unknown or invalid detail' using errcode = '22023';
  end if;

  select * into v_enquiry from public.enquiries where id = p_enquiry_id for update;
  if not found then
    raise exception 'enquiry not found' using errcode = 'P0002';
  end if;
  select schema into v_schema
  from public.form_versions
  where form_id = v_enquiry.form_id and version = v_enquiry.form_version;
  select coalesce(array_agg(f ->> 'id'), '{}') into v_known
  from jsonb_array_elements(v_schema -> 'steps') as s, jsonb_array_elements(s -> 'fields') as f;

  select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb) into v_merge
  from jsonb_each(p_patch) as e
  where e.key = any (v_known);
  v_clean := private.clean_answers(v_schema, v_enquiry.answers || v_merge);

  if v_clean is distinct from v_enquiry.answers then
    select string_agg(f ->> 'label', ', ') into v_changed
    from jsonb_array_elements(v_schema -> 'steps') as s, jsonb_array_elements(s -> 'fields') as f
    where (v_clean -> (f ->> 'id')) is distinct from (v_enquiry.answers -> (f ->> 'id'));

    insert into public.enquiry_revisions (enquiry_id, revision, form_id, form_version, answers, author)
    select p_enquiry_id, coalesce(max(revision), 0) + 1, v_enquiry.form_id, v_enquiry.form_version,
           v_clean, 'customer'
    from public.enquiry_revisions where enquiry_id = p_enquiry_id;

    update public.enquiries set answers = v_clean, updated_at = now() where id = p_enquiry_id;

    insert into public.enquiry_events (enquiry_id, kind, detail)
    values (p_enquiry_id, 'details_updated', left(v_changed, 300));
  end if;

  if 'site_street' = any (v_known) then
    perform private.sync_site_details_from_answers(p_enquiry_id);
  elsif coalesce(btrim(p_patch ->> 'site_street'), '') <> '' then
    v_site := v_enquiry.site_details;
    perform private.save_site_details(
      p_enquiry_id,
      jsonb_build_object('site_address', private.site_address_from_answers(jsonb_build_object(
        'site_street', p_patch ->> 'site_street',
        'site_unit', p_patch ->> 'site_unit',
        'location', v_enquiry.answers ->> 'location')))
        || case when v_site ? 'access_notes'
                then jsonb_build_object('access_notes', v_site -> 'access_notes')
                else '{}'::jsonb end);
  end if;

  return jsonb_build_object(
    'answers', (select answers from public.enquiries where id = p_enquiry_id),
    'site_address', (select site_details ->> 'site_address' from public.enquiries where id = p_enquiry_id));
end;
$$;

revoke all on function private.site_address_from_answers(jsonb) from public;
revoke all on function private.sync_site_details_from_answers(uuid) from public;
revoke all on function private.update_enquiry_details(uuid, jsonb) from public;

-- ---------------------------------------------------------------------------------------------
-- 3. Live durations for the landing page
-- ---------------------------------------------------------------------------------------------

create function public.public_appointment_types()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object('id', id, 'mode', mode, 'duration_minutes', duration_minutes)
      order by sort_order, id),
    '[]'::jsonb)
  from public.appointment_types
  where active;
$$;

revoke all on function public.public_appointment_types() from public, anon, authenticated;
grant execute on function public.public_appointment_types() to anon, authenticated, service_role;
