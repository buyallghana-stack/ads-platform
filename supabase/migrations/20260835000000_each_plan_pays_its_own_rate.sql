-- ============================================================================
-- Migration 187 — a stacked plan brings its own ads AND its own rate
--
-- Operator, 2026-08-12: "the ads of the manager adds up to a total of 24 rather
-- than the 27 providing he has bought all plans, and i noticed that you value
-- all the existing 24 ads at 700 points which is wrong. there are many plans
-- stacked together and each get their respective value points per ad. so in
-- this case only the 13 ads will be measured at that rate not the other ads
-- because they all carry their distinct point, you nearly cost me money."
--
-- Both halves of that are correct, and the second one is expensive.
--
-- ── WHAT THE DATABASE WAS DOING ──
--
-- `resolve_user_tier` SUMMED the money across every active subscription and
-- resolved ONE band and ONE multiplier from the total. The manager holds
-- Bronze 111 + Silver 209 + Gold 492 + Platinum 905 = GHS 1,717, which lands
-- past the top of the Platinum band, so the ceiling clamped it to ×7.000 —
-- and every ad of the day was worth `base × 7`, whichever plan's allowance it
-- came out of. A 100-point ad paid 700 points 24 times over.
--
-- The cap was not a plain sum either. `sum_bonus` mode computes
-- `free_cap + Σ(plan_cap − free_cap)`, so with a free cap of 1 the four plans
-- gave 1 + 2 + 3 + 6 + 12 = 24 rather than 3 + 4 + 7 + 13 = 27. Defensible when
-- one rate covered the day; wrong now that each plan brings its own allowance,
-- because the subtraction takes an ad away from the plan that was paid for.
--
-- ── WHAT IT DOES NOW ──
--
-- A held plan is an ALLOWANCE: so many ads, at the rate that plan's own money
-- bought. They are consumed best first, so the manager's day is
--
--     13 ads at ×6.430   (Platinum, on the 905 paid for Platinum)
--      7 ads at ×3.952   (Gold, on 492)
--      4 ads at ×2.254   (Silver, on 209)
--      3 ads at ×1.666   (Bronze, on 111)
--     ──
--     27 ads             12,522 points against the old 16,800
--
-- Best first is deliberate: somebody who watches five ads should get their
-- five best, and it is the only order in which the rate advertised on the feed
-- is the rate the next ad actually pays.
--
-- ⚠️ SPENDING MORE NO LONGER LIFTS A RATE. That was the operator's decision
-- when asked, against the alternative of letting the summed money keep setting
-- the top plan's rate (which would have paid 13,263). Money buys ads now, not
-- a better rate on ads bought earlier. [[subscription-stacking-decision]] said
-- benefits add up and every benefit is linear in money paid; the ADS still add
-- up, the RATE does not, and this migration is where those two parted.
--
-- ── NOBODY WAS PAID THIS ──
--
-- Four accounts hold a subscription and the three stacked ones are all the
-- operator's own. No withdrawal has ever been paid on a stacked balance. The
-- points already credited are left alone: they are in an append-only ledger,
-- they were credited under the rule in force, and rewriting history in a money
-- ledger to match a rule change is worse than the overpayment it corrects.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- The allowances a person holds, best rate first
-- ---------------------------------------------------------------------------

create or replace function public.user_ad_allowances(p_user_id uuid)
returns table (
  slot       int,
  tier_id    uuid,
  slug       text,
  name       text,
  ads        int,
  multiplier numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  /* ⚠️ SECURITY DEFINER TAKING A USER ID. That is the shape of the seventeen
     functions that answered the publishable key on 2026-08-05: they took an id
     and never asked who was calling. This one says what plans somebody holds
     and what their ads are worth, so it asks. Same check, same wording as
     `get_ad_feed`, which is the function it exists to serve. */
  if (select auth.uid()) is not null
     and (select auth.uid()) <> p_user_id
     and not public.is_admin()
  then
    raise exception 'Not authorised to read another user''s allowances'
      using errcode = 'insufficient_privilege';
  end if;

  return query
  with ceiling as (
    select coalesce(
             (select value::numeric from public.app_config
               where key = 'subscription_max_combined_multiplier'),
             3.500) as cap
  ),
  held as (
    select
      t.id,
      t.slug,
      t.name,
      t.sort_order,
      greatest(coalesce(t.daily_ad_cap, 0), 0) as ads,
      /* THE PLAN'S OWN MONEY, not the sum. `plan_multiplier_for_amount` is the
         same line the picker quotes when the plan is bought, so what somebody
         was shown at checkout is what their ads are worth. */
      least(
        public.plan_multiplier_for_amount(coalesce(s.amount_minor, t.price_minor)),
        (select cap from ceiling)
      ) as multiplier
    from public.user_subscriptions s
    join public.tiers t on t.id = s.tier_id
   where s.user_id = p_user_id
     and not t.is_default
     and (
       (s.status = 'active' and now() < s.current_period_end)
       or
       (s.status = 'grace' and s.grace_ends_at is not null and now() < s.grace_ends_at)
     )
  ),
  /* Stacking off: the single best plan, exactly as `resolve_user_tier` picks
     it, so the switch means what it has always meant. */
  chosen as (
    select * from held
     where coalesce(public.config_bool('subscription_stacking_enabled'), true)
    union all
    select * from (
      select * from held
       where not coalesce(public.config_bool('subscription_stacking_enabled'), true)
       order by sort_order desc, multiplier desc
       limit 1
    ) one
  ),
  /* No plan at all is still an allowance: the free tier's ads at ×1. Written
     as a fallback rather than a special case in every caller. */
  final as (
    select * from chosen
    union all
    select t.id, t.slug, t.name, t.sort_order,
           greatest(coalesce(t.daily_ad_cap, 0), 0),
           coalesce(t.reward_multiplier, 1)
      from public.tiers t
     where t.is_default
       and not exists (select 1 from chosen)
  )
  select
    row_number() over (order by f.multiplier desc, f.ads desc, f.sort_order desc)::int,
    f.id, f.slug, f.name, f.ads, f.multiplier
  from final f
  where f.ads > 0
  order by 1;
end;
$$;

revoke execute on function public.user_ad_allowances(uuid) from public, anon;
grant execute on function public.user_ad_allowances(uuid) to authenticated, service_role;


-- ---------------------------------------------------------------------------
-- What the NEXT ad is worth
-- ---------------------------------------------------------------------------
--
-- `p_done` is how many ads have already been completed today. The slice that
-- position falls into decides the rate. Past the last slice the lowest rate is
-- returned rather than nothing: the caller has its own cap check, and a display
-- that reads this must never be handed a null.

create or replace function public.ad_reward_points(
  p_user_id uuid,
  p_base    bigint,
  p_done    int default 0
)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  with slices as (
    select a.multiplier,
           sum(a.ads) over (order by a.slot rows between unbounded preceding and current row) as through
      from public.user_ad_allowances(p_user_id) a
  ),
  pick as (
    select multiplier from slices
     where through > greatest(coalesce(p_done, 0), 0)
     order by through
     limit 1
  )
  select greatest(
           floor(
             greatest(coalesce(p_base, 0), 0)
             * coalesce(
                 (select multiplier from pick),
                 /* Past the last allowance: the lowest rate they hold. */
                 (select min(multiplier) from slices),
                 1
               )
           )::bigint,
           1
         );
$$;

revoke execute on function public.ad_reward_points(uuid, bigint, int) from public, anon;
grant execute on function public.ad_reward_points(uuid, bigint, int) to authenticated, service_role;


-- ---------------------------------------------------------------------------
-- `resolve_user_tier`: the cap is the plain sum, the rate is the best plan's
-- ---------------------------------------------------------------------------
--
-- ⚠️ RESTATED FROM THE LIVE DEFINITION, not rebuilt from the migration that
-- created it. Migration 180 exists because I once rebuilt a function from its
-- original and deleted a branch added later.
--
-- Two things change. The band and the rate come from the BEST PLAN'S OWN
-- amount rather than from the summed money, and the default cap mode is `sum`:
-- every plan brings its whole allowance. `sum_bonus`, `highest` and `band`
-- still work for an operator who sets them.

create or replace function public.resolve_user_tier(p_user_id uuid)
returns public.tiers
language plpgsql
stable
set search_path = ''
as $$
declare
  v_best     bigint;
  v_band     public.tiers;
  v_default  public.tiers;
  v_free_cap int;
  v_cap      int;
  v_priority int;
  v_cooldown int;
  v_mode     text    := coalesce(public.config_text('ad_cap_combine_mode'), 'sum');
  v_stacking boolean := coalesce(public.config_bool('subscription_stacking_enabled'), true);
  v_ceiling  numeric := coalesce(
    (select value::numeric from public.app_config where key = 'subscription_max_combined_multiplier'),
    3.500);
  /* Platform-wide since 2026-08-01: no plan has its own withdrawal threshold.
     It is set on EVERY path out of this function — the free one included —
     because every screen reads its answer, and a screen disagreeing with
     `request_redemption` is the failure that rule was written to remove. */
  v_minimum  bigint := public.config_int('redemption_minimum_points');
begin
  select t.* into v_default from public.tiers t where t.is_default limit 1;
  v_default.redemption_minimum_points := v_minimum;
  v_free_cap := greatest(coalesce(v_default.daily_ad_cap, 0), 0);

  /* ⚠️ THE BEST PLAN'S OWN MONEY, NOT THE SUM. Summing it made four plans
     resolve to one top rate and paid every ad of the day at it (migration
     187). What the sum still does is nothing: money buys allowances now. */
  select coalesce(s.amount_minor, t.price_minor)
    into v_best
    from public.user_subscriptions s
    join public.tiers t on t.id = s.tier_id
   where s.user_id = p_user_id
     and not t.is_default
     and (
       (s.status = 'active' and now() < s.current_period_end)
       or
       (s.status = 'grace' and s.grace_ends_at is not null and now() < s.grace_ends_at)
     )
   order by public.plan_multiplier_for_amount(coalesce(s.amount_minor, t.price_minor)) desc,
            t.sort_order desc
   limit 1;

  if coalesce(v_best, 0) <= 0 then
    return v_default;
  end if;

  v_band := public.plan_band_for_amount(v_best);
  if v_band.id is null then
    return v_default;
  end if;

  /* The rate follows the money paid for THIS plan. It is the rate of the next
     ad, because allowances are consumed best first. */
  v_band.reward_multiplier         := least(public.plan_multiplier_for_amount(v_best), v_ceiling);
  v_band.redemption_minimum_points := v_minimum;
  v_band.is_default                := false;

  /* The whole numbers follow the PLANS HELD, and never drop below what the
     band alone would have given. */
  if v_stacking and v_mode <> 'band' then
    select
      case
        when v_mode = 'highest'   then max(t.daily_ad_cap)
        /* The old mode, kept because an operator may set it: the free ad is
           counted once and taken off every plan. It is not the default any
           more — it took an ad away from a plan that was paid for. */
        when v_mode = 'sum_bonus' then v_free_cap + coalesce(sum(greatest(t.daily_ad_cap - v_free_cap, 0)), 0)
        /* `sum`, the default since migration 187: every plan brings its whole
           allowance, so four plans are 3 + 4 + 7 + 13 = 27. */
        else coalesce(sum(t.daily_ad_cap), 0)
      end,
      max(t.ad_priority),
      min(nullif(t.ad_cooldown_seconds, 0))
      into v_cap, v_priority, v_cooldown
      from public.user_subscriptions s
      join public.tiers t on t.id = s.tier_id
     where s.user_id = p_user_id
       and not t.is_default
       and (
         (s.status = 'active' and now() < s.current_period_end)
         or
         (s.status = 'grace' and s.grace_ends_at is not null and now() < s.grace_ends_at)
       );

    v_band.daily_ad_cap := greatest(coalesce(v_cap, 0), v_band.daily_ad_cap);
    v_band.ad_priority  := greatest(coalesce(v_priority, 0), coalesce(v_band.ad_priority, 0));

    /* Lower is better, and zero means "no cooldown configured" rather than
       "instant", which is why the null trick is on the way in above. */
    if v_cooldown is not null then
      v_band.ad_cooldown_seconds := least(
        v_cooldown,
        coalesce(nullif(v_band.ad_cooldown_seconds, 0), v_cooldown)
      );
    end if;
  end if;

  return v_band;
end;
$$;

/* The mode key changes meaning by DEFAULT only. An explicit `sum_bonus` on the
   live project would keep the old arithmetic silently, so it is moved on. */
update public.app_config
   set value = 'sum'
 where key = 'ad_cap_combine_mode'
   and value = 'sum_bonus';

insert into public.app_config (key, value, description)
select 'ad_cap_combine_mode', 'sum',
       'How stacked plans combine their daily ad allowances: sum (default), sum_bonus, highest, band.'
 where not exists (select 1 from public.app_config where key = 'ad_cap_combine_mode');


-- ---------------------------------------------------------------------------
-- The two functions that value an ad
-- ---------------------------------------------------------------------------

create or replace function public.get_ad_feed(
  p_user_id uuid,
  p_format  public.ad_format default null,
  p_limit   integer default 40
)
returns table (
  id uuid, title text, description text, advertiser_name text, format public.ad_format,
  points_reward bigint, points_award bigint, video_source public.video_source,
  storage_path text, youtube_video_id text, thumbnail_path text, duration_seconds integer,
  min_watch_seconds integer, question_count integer, graded_count integer,
  attempts_used integer, attempts_remaining integer, cta_label text, cta_links jsonb,
  article_body text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_caller    uuid := (select auth.uid());
  v_retry_cap int := public.config_int('ad_retry_cap')::int;
  v_repeating boolean;
  v_min_hours int := public.config_int('ad_repeat_min_hours')::int;
  v_done      int;
begin
  if v_caller is not null and v_caller <> p_user_id and not public.is_admin() then
    raise exception 'Not authorised to read another user''s ad feed'
      using errcode = 'insufficient_privilege';
  end if;

  /* ⚠️ NO `v_tier` HERE ANY MORE. One multiplier for the whole feed is exactly
     the bug: with stacked plans the rate depends on how many ads have already
     been watched today, so the feed quotes the rate of the NEXT one. */
  select coalesce(d.ads_completed, 0) into v_done
    from public.daily_earning_counters d
   where d.user_id = p_user_id and d.day = public.utc_today();
  v_done := coalesce(v_done, 0);

  v_repeating := public.may_repeat_ads(p_user_id);

  return query
  select
    a.id,
    a.title,
    a.description,
    a.advertiser_name,
    a.format,
    a.points_reward,
    public.ad_reward_points(p_user_id, a.points_reward, v_done),
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
$$;

revoke execute on function public.get_ad_feed(uuid, public.ad_format, integer)
  from public, anon;
grant execute on function public.get_ad_feed(uuid, public.ad_format, integer)
  to authenticated, service_role;


-- ---------------------------------------------------------------------------
-- The credit itself
-- ---------------------------------------------------------------------------
--
-- ⚠️ RESTATED FROM THE LIVE DEFINITION with three changes: today's completion
-- count is read, the points come from `ad_reward_points` rather than from the
-- tier's single multiplier, and the ledger records the rate this ad was
-- actually paid at. Everything else is the live body, untouched.

CREATE OR REPLACE FUNCTION public.submit_ad_answers(p_user_id uuid, p_ad_id uuid, p_answers jsonb)
 RETURNS ad_answer_result
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_ad          public.ads;
  v_state       public.user_ad_state;
  v_tier        public.tiers;
  v_retry_cap   int;
  v_elapsed     numeric;
  v_min_watch   int;
  v_q           record;
  v_submitted   text;
  v_ok          boolean;
  v_graded      boolean;
  v_all_correct boolean := true;
  v_qcount      int := 0;
  v_visible     int := 0;
  v_first_q     uuid;
  v_points      bigint;
  v_done        int;
  v_entry       public.points_ledger;
  v_balance     bigint;
  v_left        int;
begin
  v_retry_cap := public.config_int('ad_retry_cap')::int;

  select * into v_state
    from public.user_ad_state s
   where s.user_id = p_user_id and s.ad_id = p_ad_id
   for update;

  if not found then
    return row('not_watched', 0, 0, v_retry_cap, null,
               'No view registered for this ad.')::public.ad_answer_result;
  end if;

  if v_state.status = 'completed' then
    return row('already_completed', 0, v_state.attempts_used, 0, null,
               'This ad has already been completed.')::public.ad_answer_result;
  end if;

  if v_state.status = 'failed_locked' then
    return row('locked', 0, v_state.attempts_used, 0, null,
               'No attempts remaining for this ad.')::public.ad_answer_result;
  end if;

  if v_state.watch_started_at is null then
    return row('not_watched', 0, v_state.attempts_used,
               greatest(v_retry_cap - v_state.attempts_used, 0), null,
               'Watch the ad again before answering.')::public.ad_answer_result;
  end if;

  select * into v_ad
    from public.ads a
   where a.id = p_ad_id
     and a.status = 'active'
     and (a.starts_at is null or a.starts_at <= now())
     and (a.ends_at   is null or a.ends_at   >  now())
     and (a.max_completions is null or a.completions_count < a.max_completions);

  if not found then
    return row('not_eligible', 0, v_state.attempts_used,
               greatest(v_retry_cap - v_state.attempts_used, 0), null,
               'This ad is no longer available.')::public.ad_answer_result;
  end if;

  select count(*)::int into v_qcount
    from public.ad_questions q where q.ad_id = p_ad_id;

  v_min_watch := coalesce(
    v_ad.min_watch_seconds,
    case when v_qcount = 0 then v_ad.duration_seconds else 0 end,
    0
  );
  v_elapsed := extract(epoch from (now() - v_state.watch_started_at));

  if v_elapsed < v_min_watch then
    return row('too_fast', 0, v_state.attempts_used,
               greatest(v_retry_cap - v_state.attempts_used, 0), null,
               format('Keep watching — %s more second(s) required.',
                      ceil(v_min_watch - v_elapsed)))::public.ad_answer_result;
  end if;

  for v_q in
    select q.id, q.answer_format, q.correct_answer,
           (q.correct_answer is not null
            or exists (select 1 from public.ad_question_options o
                        where o.question_id = q.id and o.is_correct)) as is_graded
      from public.visible_ad_questions(p_ad_id, p_answers) v
      join public.ad_questions q on q.id = v.question_id
     order by v.question_position
  loop
    v_visible := v_visible + 1;
    if v_first_q is null then v_first_q := v_q.id; end if;

    v_submitted := p_answers ->> v_q.id::text;
    v_graded    := v_q.is_graded;

    if v_submitted is null or length(trim(v_submitted)) = 0 then
      v_all_correct := false;
    elsif not v_graded then
      null;
    elsif v_q.answer_format = 'multiple_choice' then
      select exists (
        select 1 from public.ad_question_options o
         where o.question_id = v_q.id
           and o.id::text = v_submitted
           and o.is_correct
      ) into v_ok;
      v_all_correct := v_all_correct and v_ok;
    else
      v_all_correct := v_all_correct
        and lower(trim(v_submitted)) = lower(trim(v_q.correct_answer));
    end if;
  end loop;

  if v_qcount > 0 and v_visible = 0 then
    return row('not_eligible', 0, v_state.attempts_used,
               greatest(v_retry_cap - v_state.attempts_used, 0), null,
               'This ad has no answerable questions configured.')::public.ad_answer_result;
  end if;

  if not v_all_correct then
    update public.user_ad_state
       set attempts_used    = attempts_used + 1,
           watch_started_at = null,
           status           = case when attempts_used + 1 >= v_retry_cap
                                   then 'failed_locked'::public.user_ad_status
                                   else 'in_progress'::public.user_ad_status end,
           locked_at        = case when attempts_used + 1 >= v_retry_cap
                                   then now() else null end,
           updated_at       = now()
     where user_id = p_user_id and ad_id = p_ad_id
    returning * into v_state;

    insert into public.ad_attempts (user_id, ad_id, question_id, attempt_number,
                                    submitted_answer, is_correct, watch_seconds)
    values (p_user_id, p_ad_id, v_first_q, v_state.attempts_used,
            left(coalesce(p_answers::text, ''), 4000), false, floor(v_elapsed)::int);

    if v_state.status = 'failed_locked' then
      return row('locked', 0, v_state.attempts_used, 0, null,
                 'Incorrect. No attempts remaining for this ad.')::public.ad_answer_result;
    end if;

    return row('incorrect', 0, v_state.attempts_used,
               greatest(v_retry_cap - v_state.attempts_used, 0), null,
               'Incorrect. Watch the ad again to retry.')::public.ad_answer_result;
  end if;

  v_tier := public.resolve_user_tier(p_user_id);

  /* ⚠️ THE RATE IS NOT THE TIER'S ANY MORE (migration 187). With stacked plans
     each allowance carries the rate its own money bought, best first, so what
     this ad is worth depends on how many have already been watched today. Read
     BEFORE `credit_points`, which is what increments that counter. */
  select coalesce(d.ads_completed, 0) into v_done
    from public.daily_earning_counters d
   where d.user_id = p_user_id and d.day = public.utc_today();

  v_points := public.ad_reward_points(p_user_id, v_ad.points_reward, coalesce(v_done, 0));

  update public.ads
     set completions_count = completions_count + 1
   where id = p_ad_id
     and (max_completions is null or completions_count < max_completions);

  if not found then
    return row('not_eligible', 0, v_state.attempts_used,
               greatest(v_retry_cap - v_state.attempts_used, 0), null,
               'This ad just reached its limit.')::public.ad_answer_result;
  end if;

  v_left := greatest(v_retry_cap - v_state.attempts_used, 0);

  begin
    v_entry := public.credit_points(
      p_user_id, v_points,
      case v_ad.format when 'survey' then 'survey'::public.ledger_entry_type
                       else 'ad_view'::public.ledger_entry_type end,
      'ad', public.ad_occasion_ref(p_ad_id, v_state.times_completed + 1),
      jsonb_build_object(
        'ad_title',          v_ad.title,
        'base_points',       v_ad.points_reward,
        'tier_slug',         v_tier.slug,
        'tier_multiplier',   v_tier.reward_multiplier,
        /* What THIS ad was paid at, which on a stacked account is not the
           tier's headline rate. Derived rather than re-queried so the number
           in the ledger cannot disagree with the number credited. */
        'ad_multiplier',     round(v_points::numeric / greatest(v_ad.points_reward, 1), 3),
        'ads_done_before',   coalesce(v_done, 0),
        'watch_seconds',     floor(v_elapsed)::int,
        'attempt_number',    v_state.attempts_used + 1,
        'question_count',    v_qcount,
        'questions_shown',   v_visible
      ),
      true
    );
  exception
    when unique_violation then
      update public.user_ad_state
         set status           = 'completed',
             times_completed  = greatest(times_completed, v_state.times_completed + 1),
             completed_at     = coalesce(completed_at, now()),
             watch_started_at = null,
             updated_at       = now()
       where user_id = p_user_id and ad_id = p_ad_id;

      return row('already_completed', 0, v_state.attempts_used, 0, null,
                 'This ad has already been credited to this account.')::public.ad_answer_result;

    when sqlstate 'P0001' or sqlstate '23514' then
      if sqlerrm like '%points cap%' then
        return row('points_cap_reached', 0, v_state.attempts_used, v_left, null,
                   sqlerrm)::public.ad_answer_result;
      elsif sqlerrm like '%Cooldown%' then
        return row('cooldown_active', 0, v_state.attempts_used, v_left, null,
                   sqlerrm)::public.ad_answer_result;
      elsif sqlerrm like '%Daily cap%' then
        return row('daily_cap_reached', 0, v_state.attempts_used, v_left, null,
                   sqlerrm)::public.ad_answer_result;
      end if;
      return row('earning_blocked', 0, v_state.attempts_used, v_left, null,
                 sqlerrm)::public.ad_answer_result;
  end;

  update public.user_ad_state
     set status             = 'completed',
         attempts_used      = attempts_used + 1,
         times_completed    = times_completed + 1,
         completed_at       = now(),
         watch_completed_at = now(),
         watch_started_at   = null,
         updated_at         = now()
   where user_id = p_user_id and ad_id = p_ad_id
  returning * into v_state;

  insert into public.ad_attempts (user_id, ad_id, question_id, attempt_number,
                                  submitted_answer, is_correct, watch_seconds)
  values (p_user_id, p_ad_id, v_first_q, v_state.attempts_used,
          left(coalesce(p_answers::text, ''), 4000), true, floor(v_elapsed)::int);

  select balance into v_balance from public.user_balances where user_id = p_user_id;

  return row('correct', v_points, v_state.attempts_used, 0, v_balance,
             format('%s points added.', v_points))::public.ad_answer_result;
end;
$function$;

revoke execute on function public.submit_ad_answers(uuid, uuid, jsonb) from public, anon;
grant execute on function public.submit_ad_answers(uuid, uuid, jsonb) to authenticated, service_role;


-- ---------------------------------------------------------------------------
-- The setting's own description, which described the rule that just changed
-- ---------------------------------------------------------------------------
--
-- It called `sum_bonus` "the promise on the landing page" and never mentioned
-- `sum`. A stale description on a money setting is how the next person sets it
-- back to a rule that was deliberately left behind.

update public.app_config
   set description = 'How daily ad allowances combine for a user holding several plans. '
                     || '"sum" (default since 2026-08-12) gives every plan its whole allowance. '
                     || '"sum_bonus" counts the free allowance once and adds each plan''s cap above it. '
                     || '"band" takes only what the best plan buys. "highest" takes the best single plan. '
                     || 'The mode decides HOW MANY ads; what each ad is worth is always the rate of the '
                     || 'plan whose allowance it comes out of, best first.'
 where key = 'ad_cap_combine_mode';
