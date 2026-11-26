-- Links from the public website (q3interiors.ie), phase 1, 2026-11-28.
--
-- 1. enquiries.inspiration: the website project the visitor was looking at when they chose a
--    call or a visit (`?inspiration=<slug>`), e.g. 'fairview'. A slug only, never free text: a
--    strict pattern here, and the booking site sends only the slugs it knows. Not personal data.
-- 2. submit_enquiry_with_access gains one more defaulted parameter, p_inspiration, as it gained
--    p_session_id before: pages loaded before this release still resolve to it, and no new
--    function is callable by anon (the five stay five).
-- The new project type "Workplace fit-out" is form enquiry@3, published by
-- supabase/forms/published.sql (applied after the migrations by db:migrate).

alter table public.enquiries
  add column inspiration text
    check (inspiration is null
           or (char_length(inspiration) <= 60 and inspiration ~ '^[a-z0-9]+(-[a-z0-9]+)*$'));

comment on column public.enquiries.inspiration is
  'Slug of the q3interiors.ie project page the enquiry started from (?inspiration=), if any.';

drop function public.submit_enquiry_with_access(uuid, text, integer, jsonb, boolean, jsonb, text, uuid);

create function public.submit_enquiry_with_access(
  p_idempotency_key uuid,
  p_form_id text,
  p_form_version integer,
  p_answers jsonb,
  p_marketing_opt_in boolean default false,
  p_attribution jsonb default null,
  -- A field people never see. Anything in it means a bot: answer normally, store nothing.
  p_trap text default null,
  -- The landing session (random per tab); linked only if that session was recorded.
  p_session_id uuid default null,
  -- The website project slug the visitor came from (?inspiration=), or null.
  p_inspiration text default null
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
  v_inspiration text := nullif(btrim(coalesce(p_inspiration, '')), '');
  c_alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
begin
  -- A retry of a saved enquiry is not a new submission: no limit, same reference.
  select id, reference into v_id, v_reference from public.enquiries where idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object('reference', v_reference) || private.mint_enquiry_token(v_id);
  end if;

  if v_inspiration is not null
     and (char_length(v_inspiration) > 60 or v_inspiration !~ '^[a-z0-9]+(-[a-z0-9]+)*$') then
    raise exception 'inspiration must be a project slug' using errcode = '22023';
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
  if p_session_id is not null then
    update public.enquiries set landing_session_id = p_session_id
    where id = v_id and exists (select 1 from public.landing_sessions where id = p_session_id);
  end if;
  if v_inspiration is not null then
    update public.enquiries set inspiration = v_inspiration where id = v_id;
  end if;
  perform private.queue_staff_alert(v_id, 'staff_new_enquiry');
  return jsonb_build_object('reference', v_reference) || private.mint_enquiry_token(v_id);
end;
$$;

revoke all on function public.submit_enquiry_with_access(uuid, text, integer, jsonb, boolean, jsonb, text, uuid, text) from public, anon, authenticated;
grant execute on function public.submit_enquiry_with_access(uuid, text, integer, jsonb, boolean, jsonb, text, uuid, text) to anon, authenticated;
