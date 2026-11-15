-- Portfolio screen and per-change scorecard (decision D58). An agency that runs many websites needs one page that says
-- which website needs attention first, and whether the changes and advice it accepted actually moved Search Console.
--
-- 1. Site memory gains kind 'scorecard': one entry per completed change or accepted advice that named pages (written by
--    the scheduler, src/god/scorecard.mjs), with its before-baseline and each window's verdict frozen on the entry. The
--    current entry holds everything needed, so superseded copies are pruned with the derived reports (D57) after 14 days.
-- 2. public.portfolio(): one row per website of the caller's agencies, sorted "needs attention" first: clicks over the
--    last 28 days and the change against the 28 days before (like-for-like daily totals from the `history` report),
--    pages Google has not indexed (`inspect`), stale data (private.site_freshness), today's alerts, approvals waiting,
--    AI spend over 7 days, live or paused, and the scorecard's win/loss counts. With p_site, also that website's
--    scorecard entries. Agency members only (private.is_member); anyone else gets no rows.

alter table public.site_memory drop constraint if exists site_memory_kind_check;
alter table public.site_memory add constraint site_memory_kind_check
  check (kind in ('identity', 'brand', 'strategy', 'objective', 'decision', 'experiment', 'lesson', 'failure', 'question', 'answer', 'report', 'setting', 'scorecard'));

create or replace function public.portfolio(p_site uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_rows jsonb; v_card jsonb := null;
begin
  if v_uid is null then raise exception 'not allowed'; end if;
  if p_site is not null and not exists (select 1 from public.sites s where s.id = p_site and private.is_member(s.org_id)) then raise exception 'not allowed'; end if;
  with site as (
    select s.id, s.name, s.url, s.status, s.org_id, coalesce(o.brand_name, o.name) agency
      from public.sites s join public.orgs o on o.id = s.org_id
     where private.is_member(s.org_id) and (p_site is null or s.id = p_site)),
  mem as (
    select x.id,
      (select m.value from public.site_memory m where m.site_id = x.id and m.kind = 'report' and m.key = 'search_console' and m.superseded_at is null limit 1) sc,
      (select m.value->'daily' from public.site_memory m where m.site_id = x.id and m.kind = 'report' and m.key = 'history' and m.superseded_at is null and jsonb_typeof(m.value->'daily') = 'object' limit 1) daily,
      (select m.value from public.site_memory m where m.site_id = x.id and m.kind = 'report' and m.key = 'inspect' and m.superseded_at is null limit 1) insp
    from site x),
  -- Like-for-like: the 28 days ending on the snapshot's last day against the 28 days before, from the daily totals.
  win as (
    select m.id, (m.sc->>'to')::date to_day,
      coalesce((select jsonb_build_object(
          'cur', sum((d.value->>0)::numeric) filter (where d.key::date between (m.sc->>'to')::date - 27 and (m.sc->>'to')::date),
          'curDays', count(*) filter (where d.key::date between (m.sc->>'to')::date - 27 and (m.sc->>'to')::date),
          'prev', sum((d.value->>0)::numeric) filter (where d.key::date between (m.sc->>'to')::date - 55 and (m.sc->>'to')::date - 28),
          'prevDays', count(*) filter (where d.key::date between (m.sc->>'to')::date - 55 and (m.sc->>'to')::date - 28))
        from jsonb_each(m.daily) d where d.key ~ '^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$' and jsonb_typeof(d.value) = 'array'), '{}'::jsonb) w
    from mem m where coalesce(m.sc->>'to', '') ~ '^\d{4}-\d{2}-\d{2}$' and m.daily is not null),
  base as (
    select x.*, m.sc, m.insp, w.w,
      private.site_freshness(x.id) fresh,
      (select count(*) from public.jobs j where j.site_id = x.id and j.status = 'awaiting_approval') waiting,
      (select min(j.updated_at) from public.jobs j where j.site_id = x.id and j.status = 'awaiting_approval') waiting_since,
      (select count(*) from public.jobs j where j.site_id = x.id and j.status = 'escalated') escalated,
      coalesce((select sum(c.usd) from public.job_costs c where c.site_id = x.id and c.at > now() - interval '7 days'), 0) spend7,
      (select t.outcome from public.god_site_ticks t where t.site_id = x.id) tick,
      (select jsonb_build_object(
          'win', count(*) filter (where coalesce(m.value->>'label', 'too_early') = 'win'),
          'loss', count(*) filter (where m.value->>'label' = 'loss'),
          'flat', count(*) filter (where m.value->>'label' = 'flat'),
          'tooEarly', count(*) filter (where coalesce(m.value->>'label', 'too_early') = 'too_early'),
          'notEnoughData', count(*) filter (where m.value->>'label' = 'not_enough_data'))
        from public.site_memory m where m.site_id = x.id and m.kind = 'scorecard' and m.superseded_at is null and m.value->>'supersededBy' is null) card,
      (select count(*) from jsonb_each(case when jsonb_typeof(m.insp->'results') = 'object' then m.insp->'results' else '{}'::jsonb end) r
        where coalesce(r.value->>'verdict', '') <> 'PASS' and coalesce(r.value->>'coverage', '') !~* '^(submitted and indexed|indexed, not submitted)'
          and coalesce(r.value->>'coverage', '') !~* 'redirect|alternate') not_indexed,
      (select count(*) from jsonb_object_keys(case when jsonb_typeof(m.insp->'results') = 'object' then m.insp->'results' else '{}'::jsonb end)) inspected
    from site x join mem m on m.id = x.id left join win w on w.id = x.id),
  calc as (
    select r.*,
      case when (r.w->>'curDays')::int >= 24 and (r.w->>'prevDays')::int >= 24 and (r.w->>'prev')::numeric > 0
           then round(((r.w->>'cur')::numeric - (r.w->>'prev')::numeric) / (r.w->>'prev')::numeric, 3) end clicks_change,
      case when jsonb_typeof(r.tick->'alerts') = 'array' then jsonb_array_length(r.tick->'alerts') else 0 end alerts,
      r.tick->>'error' plan_error
    from base r),
  scored as (
    select c.*, array_remove(array[
        case when c.escalated > 0 then c.escalated || ' stopped and need' || case when c.escalated = 1 then 's' else '' end || ' a person' end,
        case when c.plan_error is not null then 'planning failed' end,
        case when c.alerts > 0 then c.alerts || ' alert' || case when c.alerts = 1 then '' else 's' end || ' today' end,
        case when jsonb_array_length(c.fresh->'stale') > 0 then 'stale data' end,
        case when c.clicks_change <= -0.2 then 'clicks down ' || round(-c.clicks_change * 100) || '%' end,
        case when (c.card->>'loss')::int > 0 then (c.card->>'loss') || ' change' || case when (c.card->>'loss')::int = 1 then '' else 's' end || ' lost traffic' end,
        case when c.waiting > 0 then c.waiting || ' waiting for approval' end,
        case when c.not_indexed > 0 then c.not_indexed || ' page' || case when c.not_indexed = 1 then '' else 's' end || ' not indexed' end,
        case when (c.fresh->>'inspectBlocked')::boolean then 'index status refused' end], null) reasons,
      -- Weights: work that is stuck or broken first, then traffic falling, then decisions waiting, then index gaps.
      (case when c.escalated > 0 then 40 else 0 end) + (case when c.plan_error is not null then 30 else 0 end) + least(c.alerts, 3) * 15
        + (case when jsonb_array_length(c.fresh->'stale') > 0 then 12 else 0 end) + (case when c.clicks_change <= -0.2 then 20 else 0 end)
        + least((c.card->>'loss')::int, 3) * 5 + least(c.waiting, 5) * 4 + (case when c.waiting_since < now() - interval '3 days' then 6 else 0 end)
        + least(c.not_indexed, 10) + (case when (c.fresh->>'inspectBlocked')::boolean then 2 else 0 end) score
    from calc c)
  select coalesce(jsonb_agg(jsonb_build_object(
      'site', s.id, 'name', s.name, 'url', s.url, 'agency', s.agency, 'status', case when s.status = 'paused' then 'paused' else 'live' end,
      'clicks28', (s.sc->'totals'->>'clicks')::numeric, 'impressions28', (s.sc->'totals'->>'impressions')::numeric,
      'searchTo', s.sc->>'to', 'searchAt', s.sc->>'generatedAt', 'property', s.sc->>'property',
      'clicksNow', (s.w->>'cur')::numeric, 'clicksBefore', (s.w->>'prev')::numeric, 'clicksChange', s.clicks_change,
      'notIndexed', case when s.inspected > 0 then s.not_indexed end, 'inspected', s.inspected, 'inspectBlocked', coalesce((s.fresh->>'inspectBlocked')::boolean, false),
      'stale', s.fresh->'stale', 'alerts', s.alerts, 'planError', left(s.plan_error, 200), 'escalated', s.escalated,
      'waiting', s.waiting, 'waitingSince', s.waiting_since, 'spend7Usd', round(s.spend7, 4),
      'scorecard', s.card, 'attention', case when s.status = 'paused' then 0 else s.score end, 'reasons', to_jsonb(s.reasons))
    order by (s.status = 'paused'), case when s.status = 'paused' then 0 else s.score end desc, s.name), '[]'::jsonb)
  into v_rows from scored s;

  if p_site is not null then
    select coalesce(jsonb_agg(m.value || jsonb_build_object('key', m.key) order by m.value->>'changedAt' desc, m.key), '[]'::jsonb) into v_card
      from (select m.key, m.value from public.site_memory m where m.site_id = p_site and m.kind = 'scorecard' and m.superseded_at is null
             order by m.value->>'changedAt' desc limit 100) m;
  end if;
  return jsonb_build_object('generatedAt', now(), 'sites', v_rows) || case when v_card is null then '{}'::jsonb else jsonb_build_object('scorecard', v_card) end;
end $$;
revoke all on function public.portfolio(uuid) from public, anon, authenticated;
grant execute on function public.portfolio(uuid) to authenticated;

-- The daily call (D57) also prunes superseded scorecard copies after 14 days: the current entry carries the frozen
-- baseline and verdicts. Everything else is unchanged from 20261119000000_daily_digest.sql.
create or replace function public.record_daily_digests(p_limit int default 50, p_after_hour int default 7)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_day date := (now() at time zone 'utc')::date; n int := 0; v_pruned int := 0; o record; d jsonb;
begin
  if extract(hour from now() at time zone 'utc') < coalesce(p_after_hour, 7) then return jsonb_build_object('recorded', 0, 'waiting', 'until ' || coalesce(p_after_hour, 7) || ':00 UTC'); end if;
  for o in select distinct s.org_id from public.sites s where not exists (select 1 from public.agency_digests g where g.org_id = s.org_id and g.day = v_day)
           limit greatest(least(coalesce(p_limit, 50), 500), 1) loop
    d := private.agency_digest(o.org_id);
    insert into public.agency_digests (org_id, day, digest, attention) values (o.org_id, v_day, d, coalesce((d->>'attention')::boolean, false)) on conflict (org_id, day) do nothing;
    n := n + 1;
  end loop;
  if n > 0 then
    with old as (select m.id from public.site_memory m
                  where ((m.kind = 'report' and m.key in ('search_console', 'history', 'priorities', 'inspect', 'speed', 'analytics')) or m.kind = 'scorecard')
                    and m.superseded_at is not null and m.superseded_at < now() - interval '14 days' limit 5000)
    delete from public.site_memory m using old where m.id = old.id;
    get diagnostics v_pruned = row_count;
    delete from public.agency_digests where day < v_day - 90;
  end if;
  return jsonb_build_object('recorded', n, 'pruned', v_pruned);
end $$;
revoke all on function public.record_daily_digests(int, int) from public, anon, authenticated;
grant execute on function public.record_daily_digests(int, int) to service_role;
