-- ============================================================================
-- Migration 096 — an ad may be served again, but only when there is nothing
-- else to serve
--
-- Operator, 2026-08-01: *"ads must repeat if there are no different ads
-- available. failed ads must repeat if there are no new ads. as soon as we
-- start we are not going to have massive number of advertisers."*
--
-- THE SHAPE OF THE RULE. A completed ad stays out of the feed exactly as
-- before, until the person has NOTHING ELSE — no unfinished ad of any format
-- that they are eligible for. Only then does the pool reopen, oldest
-- completion first, so the ad they just finished is the last one to come back.
-- It is a fallback, not a mode: the moment a single new ad is published, that
-- ad is what they see, and repeats stop on their own.
--
-- WHY THIS IS NOT SIMPLY "LET ADS REPEAT". Two people are paying attention to
-- this number. The advertiser is buying completions and would rather have
-- twenty people once than one person twenty times; and a farm's whole economy
-- is how much one account can be worth. Gating repeats on exhaustion keeps
-- both of those true while there is inventory, and only relaxes them when the
-- alternative is an empty screen — which, before there are many advertisers,
-- is the worse of the two.
--
-- WHAT KEEPS THE MONEY HONEST. `points_ledger_source_once_idx` is the last
-- line of defence that one ad pays one person once, and it works by making a
-- second credit for the same (user, entry type, reference) UNREPRESENTABLE
-- rather than merely refused. That guarantee is kept, and narrowed rather than
-- dropped: the reference now carries the OCCASION, so the rule becomes "one
-- credit per completion" instead of "one credit per ad". A retry, a double
-- submit or a replayed request still cannot pay twice for the same occasion.
-- The first completion keeps the bare ad id it has always had, so nothing in
-- the existing history changes meaning. (Migration 097 does that half.)
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. The levers
-- ---------------------------------------------------------------------------

insert into public.app_config (key, value, value_type, min_value, max_value, is_public, description)
values
  ('ad_repeat_when_exhausted', 'true', 'bool', null, null, true,
   'When somebody has finished every ad available to them, offer the finished ones again rather than an empty feed. Off means the feed simply empties until new ads are published — which is the right setting once there is enough inventory to fill a day.'),

  ('ad_repeat_min_hours', '0', 'int', 0, 8760, true,
   'The least time that must pass after finishing an ad before it may be offered to that person again. 0 means as soon as they have run out of everything else. Raise it if repeats start looking like a way to farm.')
on conflict (key) do nothing;


-- ---------------------------------------------------------------------------
-- 2. How many times this person has finished this ad
-- ---------------------------------------------------------------------------
--
-- Backfilled to 1 for anything already completed, because that is what it
-- means: the next completion of those rows is the SECOND, and must not be
-- written with the reference the first one already holds.

alter table public.user_ad_state
  add column if not exists times_completed int not null default 0;

update public.user_ad_state
   set times_completed = 1
 where status = 'completed' and times_completed = 0;

comment on column public.user_ad_state.times_completed is
  'How many times this person has completed this ad and been paid for it. The ledger reference carries this number from the second completion onwards, which is what keeps one-credit-per-completion structurally guaranteed once ads may repeat.';


-- ---------------------------------------------------------------------------
-- 3. The reference an occasion is paid under
-- ---------------------------------------------------------------------------

create or replace function public.ad_occasion_ref(p_ad_id uuid, p_occasion int)
returns text
language sql
immutable
set search_path = ''
as $$
  /* The first completion keeps the bare id it has always had — every ledger
     row written before repeats existed is occasion 1, and rewriting what those
     rows mean to make room for a feature is not a thing to do to history. */
  select case when coalesce(p_occasion, 1) <= 1
              then p_ad_id::text
              else p_ad_id::text || '#' || p_occasion end;
$$;

comment on function public.ad_occasion_ref(uuid, int) is
  'The points_ledger reference for one completion of one ad. Occasion 1 is the bare ad id, so existing history is untouched.';


-- ---------------------------------------------------------------------------
-- 4. WHICH ADS THIS PERSON MAY BE SERVED — one definition, used twice
-- ---------------------------------------------------------------------------
--
-- The targeting and scheduling rules used to live only inside `get_ad_feed`.
-- They now decide two things — what to show, and whether the person has run
-- out — and two copies of a predicate this long would drift within a month.
-- Anything eligibility-related belongs here from now on.

create or replace function public.eligible_ad_ids(p_user_id uuid)
returns table (ad_id uuid)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_inclusive boolean := public.config_bool('ad_targeting_includes_lower_tiers');
  v_tier_ids  uuid[];
  v_rank      int;
begin
  select array_agg(t.tier_id), max(t.sort_order)
    into v_tier_ids, v_rank
    from public.user_target_tiers(p_user_id) t;

  return query
  select a.id
    from public.ads a
   where a.status = 'active'
     and (a.starts_at is null or a.starts_at <= now())
     and (a.ends_at   is null or a.ends_at   >  now())
     and (a.max_completions is null or a.completions_count < a.max_completions)
     and (
       not exists (select 1 from public.ad_tiers x where x.ad_id = a.id)
       or (
         case
           when v_inclusive then
             coalesce((
               select min(t2.sort_order)
               from public.ad_tiers x
               join public.tiers t2 on t2.id = x.tier_id
               where x.ad_id = a.id
             ), 0) <= coalesce(v_rank, 0)
           else
             exists (
               select 1 from public.ad_tiers x
               where x.ad_id = a.id and x.tier_id = any (v_tier_ids)
             )
         end
       )
     );
end;
$$;

revoke execute on function public.eligible_ad_ids(uuid) from public, anon;
grant execute on function public.eligible_ad_ids(uuid) to authenticated, service_role;


/**
 * Is there anything this person has NOT finished?
 *
 * The question the repeat rule turns on, and deliberately asked across every
 * format: somebody with videos left but no surveys has not run out, and their
 * Surveys tab should say so rather than start repeating.
 */
create or replace function public.user_has_fresh_ads(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.eligible_ad_ids(p_user_id) e
      left join public.user_ad_state s
        on s.user_id = p_user_id and s.ad_id = e.ad_id
     where coalesce(s.status, 'in_progress') not in ('completed', 'failed_locked')
  );
$$;

revoke execute on function public.user_has_fresh_ads(uuid) from public, anon;
grant execute on function public.user_has_fresh_ads(uuid) to authenticated, service_role;


/**
 * May this person be offered an ad they have already finished?
 *
 * Both the feed and `register_ad_view` ask this, and they must never disagree
 * — a feed that offers a repeat the register then refuses is a dead card, and
 * a register that allows one the feed never offered is a way to re-watch a
 * favourite ad while fresh ones sit unwatched.
 */
create or replace function public.may_repeat_ads(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.config_bool('ad_repeat_when_exhausted')
     and not public.user_has_fresh_ads(p_user_id);
$$;

revoke execute on function public.may_repeat_ads(uuid) from public, anon;
grant execute on function public.may_repeat_ads(uuid) to authenticated, service_role;


-- ---------------------------------------------------------------------------
-- 5. The feed
-- ---------------------------------------------------------------------------
--
-- Drop and recreate: same return type, but the eligibility half of the WHERE
-- has moved out to `eligible_ad_ids` and the finished-ad rule has arrived.

drop function if exists public.get_ad_feed(uuid, public.ad_format, integer);

CREATE OR REPLACE FUNCTION public.get_ad_feed(p_user_id uuid, p_format ad_format DEFAULT NULL::ad_format, p_limit integer DEFAULT 40)
 RETURNS TABLE(id uuid, title text, description text, advertiser_name text, format ad_format, points_reward bigint, points_award bigint, video_source video_source, storage_path text, youtube_video_id text, thumbnail_path text, duration_seconds integer, min_watch_seconds integer, question_count integer, graded_count integer, attempts_used integer, attempts_remaining integer, cta_label text, cta_links jsonb, article_body text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_caller    uuid := (select auth.uid());
  v_tier      public.tiers;
  v_retry_cap int := public.config_int('ad_retry_cap')::int;
  v_repeating boolean;
  v_min_hours int := public.config_int('ad_repeat_min_hours')::int;
begin
  if v_caller is not null and v_caller <> p_user_id and not public.is_admin() then
    raise exception 'Not authorised to read another user''s ad feed'
      using errcode = 'insufficient_privilege';
  end if;

  v_tier := public.resolve_user_tier(p_user_id);

  /* Asked ONCE per call. It is the same answer for every row, and asking it
     per row would run the eligibility query once per ad. */
  v_repeating := public.may_repeat_ads(p_user_id);

  return query
  select
    a.id,
    a.title,
    a.description,
    a.advertiser_name,
    a.format,
    a.points_reward,
    greatest(floor(a.points_reward * v_tier.reward_multiplier)::bigint, 1),
    a.video_source,
    a.storage_path,
    a.youtube_video_id,
    a.thumbnail_path,
    a.duration_seconds,
    a.min_watch_seconds,
    (select count(*)::int from public.ad_questions q where q.ad_id = a.id),
    (select count(*)::int
       from public.ad_questions q
      where q.ad_id = a.id
        and (
          q.correct_answer is not null
          or exists (select 1 from public.ad_question_options o
                      where o.question_id = q.id and o.is_correct)
        )),
    /* On a repeat the attempt counter starts again: the previous attempts
       belong to the completion that has already been paid, and carrying them
       forward would offer somebody an ad with no tries left. */
    case when v_repeating and coalesce(s.status, 'in_progress') in ('completed', 'failed_locked')
         then 0 else coalesce(s.attempts_used, 0) end,
    case when v_repeating and coalesce(s.status, 'in_progress') in ('completed', 'failed_locked')
         then v_retry_cap else greatest(v_retry_cap - coalesce(s.attempts_used, 0), 0) end,
    a.cta_label,
    a.cta_links,
    a.article_body
  from public.ads a
  join public.eligible_ad_ids(p_user_id) e on e.ad_id = a.id
  left join public.user_ad_state s
    on s.user_id = p_user_id and s.ad_id = a.id
  where (p_format is null or a.format = p_format)
    and (
      -- The ordinary case: anything not finished.
      coalesce(s.status, 'in_progress') not in ('completed', 'failed_locked')
      or (
        -- The fallback: finished ads, but only when nothing else is left and
        -- enough time has passed since this one was finished.
        v_repeating
        and (
          v_min_hours <= 0
          or coalesce(s.completed_at, s.updated_at) <= now() - make_interval(hours => v_min_hours)
        )
      )
    )
  order by
    /* Oldest finished first when repeating, so the ad somebody has just
       watched is the last one to come back. Null for every row in the
       ordinary case, which leaves the weighted draw below in charge. */
    case when v_repeating then coalesce(s.completed_at, s.updated_at) end asc nulls first,
    -ln(
      (abs(hashtextextended(
             p_user_id::text || a.id::text || public.utc_today()::text, 0
           )) % 1000000 + 1)::numeric / 1000001.0
    ) / a.weight
  limit greatest(p_limit, 1);
end;
$function$
;

revoke execute on function public.get_ad_feed(uuid, public.ad_format, integer) from public, anon;
grant execute on function public.get_ad_feed(uuid, public.ad_format, integer) to authenticated;


-- ---------------------------------------------------------------------------
-- 6. Starting a repeat
-- ---------------------------------------------------------------------------
--
-- `register_ad_view` refused a finished ad outright. It still does — unless
-- the same rule the feed used to offer it says otherwise, asked here again
-- rather than trusted from the client. Re-opening starts a NEW attempt: the
-- status goes back to in_progress and the attempt counter resets, because the
-- attempts that came before belong to a completion that has already been paid.

create or replace function public.register_ad_view(p_user_id uuid, p_ad_id uuid)
returns timestamp with time zone
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ad     public.ads;
  v_state  public.user_ad_state;
  v_now    timestamptz := clock_timestamp();
  v_repeat boolean;
  v_hours  int := public.config_int('ad_repeat_min_hours')::int;
begin
  select * into v_ad
    from public.ads a
   where a.id = p_ad_id
     and a.status = 'active'
     and (a.starts_at is null or a.starts_at <= v_now)
     and (a.ends_at   is null or a.ends_at   >  v_now)
     and (a.max_completions is null or a.completions_count < a.max_completions);

  if not found then
    raise exception 'Ad is not available' using errcode = 'check_violation';
  end if;

  select * into v_state
    from public.user_ad_state s
   where s.user_id = p_user_id and s.ad_id = p_ad_id;

  if found and v_state.status in ('completed', 'failed_locked') then
    v_repeat := public.may_repeat_ads(p_user_id);

    if not v_repeat then
      raise exception 'Ad is closed for this user (%)', v_state.status
        using errcode = 'check_violation';
    end if;

    if v_hours > 0
       and coalesce(v_state.completed_at, v_state.updated_at) > v_now - make_interval(hours => v_hours) then
      raise exception 'This ad can be watched again later' using errcode = 'check_violation';
    end if;

    update public.user_ad_state
       set status             = 'in_progress',
           attempts_used      = 0,
           watch_started_at   = v_now,
           watch_completed_at = null,
           completed_at       = null,
           locked_at          = null,
           updated_at         = now()
     where user_id = p_user_id and ad_id = p_ad_id;

    return v_now;
  end if;

  insert into public.user_ad_state (user_id, ad_id, status, watch_started_at)
  values (p_user_id, p_ad_id, 'in_progress', v_now)
  on conflict (user_id, ad_id) do update
    set watch_started_at   = v_now,
        watch_completed_at = null,
        updated_at         = now();

  return v_now;
end;
$$;

revoke execute on function public.register_ad_view(uuid, uuid) from public, anon, authenticated;
grant execute on function public.register_ad_view(uuid, uuid) to service_role;
