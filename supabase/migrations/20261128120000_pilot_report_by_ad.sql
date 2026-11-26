-- Pilot measures per ad: one row per utm_content within one campaign, so staff can tell the
-- ads of a campaign apart. A sibling of pilot_report (staff only, same measures, same date
-- range rules) rather than a new dimension in it, so staff consoles loaded before this release
-- see exactly what they saw before.
--
-- utm_content comes from the public: record_visit and submit_enquiry already trim it and cap it
-- at 200 characters. Here the rows are capped: the 25 contents with the most sessions plus saved
-- enquiries keep their own row; the rest are folded into one '(other)' row. Sessions and
-- enquiries without a content tag are '(none)'.

create function public.pilot_report_by_content(p_from date, p_to date, p_campaign text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_rows jsonb;
begin
  if not public.is_staff() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 3660 then
    raise exception 'invalid date range' using errcode = '22023';
  end if;
  if p_campaign is null or char_length(p_campaign) not between 1 and 200 then
    raise exception 'invalid campaign' using errcode = '22023';
  end if;

  with s as (
    select ls.chosen_route,
           coalesce(nullif(ls.utm_content, ''), '(none)') as content
    from public.landing_sessions ls
    where (ls.started_at at time zone 'Europe/Dublin')::date between p_from and p_to
      and coalesce(nullif(ls.utm_campaign, ''), '(unknown)') = p_campaign
  ),
  e as (
    select en.id, en.status, en.submitted_at, en.chase_flagged_at, en.landing_session_id,
           en.outcome, en.outcome_value, en.quote_amount,
           coalesce(nullif(a.utm_content, ''), '(none)') as content
    from public.enquiries en
    left join public.enquiry_attribution a on a.enquiry_id = en.id
    where (en.submitted_at at time zone 'Europe/Dublin')::date between p_from and p_to
      and coalesce(nullif(a.utm_campaign, ''), '(unknown)') = p_campaign
  ),
  -- The cap: rank contents by sessions plus saved enquiries; past 25, fold into '(other)'.
  weight as (
    select content, count(*) as n from (
      select content from s union all select content from e
    ) x
    group by content
  ),
  bucket as (
    select content,
           case when content = '(none)'
                  or row_number() over (partition by content = '(none)' order by n desc, content) <= 25
                then content else '(other)' end as key
    from weight
  ),
  b as (
    select bk.enquiry_id,
           min(bk.confirmed_at) as confirmed_at,
           bool_or(bk.attendance = 'attended') as attended
    from public.bookings bk
    where bk.enquiry_id in (select id from e) and bk.confirmed_at is not null
    group by bk.enquiry_id
  ),
  eb as (
    select e.*, bu.key, b.confirmed_at, coalesce(b.attended, false) as attended,
           ls.started_at as session_started
    from e
    join bucket bu on bu.content = e.content
    left join b on b.enquiry_id = e.id
    left join public.landing_sessions ls on ls.id = e.landing_session_id
  ),
  sess as (
    select bu.key, count(*) as sessions, count(*) filter (where s.chosen_route is not null) as chose
    from s join bucket bu on bu.content = s.content
    group by bu.key
  ),
  enq as (
    select key,
           count(*) as saved,
           count(*) filter (where confirmed_at is not null) as booked,
           count(*) filter (where attended) as attended,
           count(*) filter (where attended and status <> 'unsuitable') as suitable_attended,
           count(*) filter (where confirmed_at is not null and chase_flagged_at is not null) as chased,
           count(*) filter (where quote_amount is not null or outcome = 'won') as quoted,
           count(*) filter (where outcome = 'won') as won,
           coalesce(sum(outcome_value) filter (where outcome = 'won'), 0) as won_value,
           percentile_cont(0.5) within group (order by extract(epoch from submitted_at - session_started))
             filter (where session_started is not null) as median_to_saved_seconds,
           percentile_cont(0.5) within group (order by extract(epoch from confirmed_at - session_started))
             filter (where session_started is not null and confirmed_at is not null) as median_to_booked_seconds
    from eb
    group by key
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'dim', 'content',
           'key', coalesce(sess.key, enq.key),
           'sessions', sess.sessions,
           'chose', sess.chose,
           'saved', coalesce(enq.saved, 0),
           'booked', coalesce(enq.booked, 0),
           'attended', coalesce(enq.attended, 0),
           'suitable_attended', coalesce(enq.suitable_attended, 0),
           'chased', coalesce(enq.chased, 0),
           'quoted', coalesce(enq.quoted, 0),
           'won', coalesce(enq.won, 0),
           'won_value', coalesce(enq.won_value, 0),
           'median_to_saved_seconds', round(enq.median_to_saved_seconds::numeric),
           'median_to_booked_seconds', round(enq.median_to_booked_seconds::numeric))
         order by coalesce(sess.key, enq.key) in ('(none)', '(other)'),
                  coalesce(sess.sessions, 0) + coalesce(enq.saved, 0) desc,
                  coalesce(sess.key, enq.key)), '[]'::jsonb)
  into v_rows
  from sess full join enq on enq.key = sess.key;

  return jsonb_build_object('campaign', p_campaign, 'cap', 25, 'rows', v_rows);
end;
$$;

revoke all on function public.pilot_report_by_content(date, date, text) from public, anon, authenticated;
grant execute on function public.pilot_report_by_content(date, date, text) to authenticated;
