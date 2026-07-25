-- ============================================================================
-- Migration 045 — serving and grading learn about targeting and skip logic
--
-- get_ad_feed              filters by the ad's tier targeting
-- get_ad_questions_for_user returns rules, and one row per QUESTION
-- submit_ad_answers        requires and grades only the VISIBLE questions
--
-- The last one is the money-relevant part. Grading previously demanded an
-- answer to every question on the ad; with skip logic that would fail every
-- branching survey, because a respondent who was never shown a question has
-- no answer to give. Visibility is recomputed here from the submitted answers
-- — never trusted from the client — so skipping a question you SHOULD have
-- been asked still fails, and skipping one the rules hid does not.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- get_ad_feed — now respects ad_tiers
-- ---------------------------------------------------------------------------

drop function if exists public.get_ad_feed(uuid, public.ad_format, int);

create function public.get_ad_feed(
  p_user_id uuid,
  p_format  public.ad_format default null,
  p_limit   int default 40
)
returns table (
  id                 uuid,
  title              text,
  description        text,
  advertiser_name    text,
  format             public.ad_format,
  points_reward      bigint,
  points_award       bigint,
  video_source       public.video_source,
  storage_path       text,
  youtube_video_id   text,
  thumbnail_path     text,
  duration_seconds   int,
  min_watch_seconds  int,
  question_count     int,
  graded_count       int,
  attempts_used      int,
  attempts_remaining int
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_caller    uuid := (select auth.uid());
  v_tier      public.tiers;
  v_retry_cap int := public.config_int('ad_retry_cap')::int;
  v_inclusive boolean := public.config_bool('ad_targeting_includes_lower_tiers');
  v_tier_ids  uuid[];
  v_rank      int;
begin
  if v_caller is not null and v_caller <> p_user_id and not public.is_admin() then
    raise exception 'Not authorised to read another user''s ad feed'
      using errcode = 'insufficient_privilege';
  end if;

  v_tier := public.resolve_user_tier(p_user_id);

  -- The plans this person actually holds, and the highest of them. Targeting
  -- works off held plans, not the synthetic combined tier — see
  -- user_target_tiers.
  select array_agg(t.tier_id), max(t.sort_order)
    into v_tier_ids, v_rank
    from public.user_target_tiers(p_user_id) t;

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
    coalesce(s.attempts_used, 0),
    greatest(v_retry_cap - coalesce(s.attempts_used, 0), 0)
  from public.ads a
  left join public.user_ad_state s
    on s.user_id = p_user_id and s.ad_id = a.id
  where a.status = 'active'
    and (p_format is null or a.format = p_format)
    and (a.starts_at is null or a.starts_at <= now())
    and (a.ends_at   is null or a.ends_at   >  now())
    and (a.max_completions is null or a.completions_count < a.max_completions)
    and coalesce(s.status, 'in_progress') not in ('completed', 'failed_locked')
    -- Tier targeting. An ad with no ad_tiers rows is for everybody, which is
    -- the common case and must stay the zero-configuration one.
    and (
      not exists (select 1 from public.ad_tiers x where x.ad_id = a.id)
      or (
        case
          when v_inclusive then
            -- Inclusive: holding a higher plan also gets you the ads aimed at
            -- cheaper ones, so upgrading never shrinks the pool.
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
    )
  order by
    -ln(
      (abs(hashtextextended(
             p_user_id::text || a.id::text || public.utc_today()::text, 0
           )) % 1000000 + 1)::numeric / 1000001.0
    ) / a.weight
  limit greatest(p_limit, 1);
end;
$$;

comment on function public.get_ad_feed(uuid, public.ad_format, int) is
  'The ads tab in one call, filtered to ads targeted at this user''s plans (no ad_tiers rows = everyone). graded_count of zero means nothing on the ad has a right answer.';

revoke execute on function public.get_ad_feed(uuid, public.ad_format, int) from public, anon;
grant execute on function public.get_ad_feed(uuid, public.ad_format, int)
  to authenticated, service_role;


-- ---------------------------------------------------------------------------
-- get_ad_questions_for_user — one row per question, with its rules
-- ---------------------------------------------------------------------------
--
-- Reshaped from row-per-option: the player now needs options AND rules per
-- question, and two nested lists do not survive a flat join without the
-- caller doing a second fold. Correctness is unchanged — is_correct and
-- correct_answer are still structurally absent, so the answer key still
-- cannot leave the database.
--
-- The rules ARE sent to the client, and that is safe: a rule names an option
-- the client already has, and knowing "question 4 appears if you answered
-- Female" reveals nothing about which answer earns points.

drop function if exists public.get_ad_questions_for_user(uuid);

create function public.get_ad_questions_for_user(p_ad_id uuid)
returns table (
  question_id     uuid,
  question_index  int,
  show_at_seconds int,
  question_text   text,
  answer_format   public.answer_format,
  condition_mode  public.question_condition_mode,
  options         jsonb,
  rules           jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    q.id,
    q.position,
    q.show_at_seconds,
    q.question_text,
    q.answer_format,
    q.condition_mode,
    coalesce(
      (select jsonb_agg(jsonb_build_object('id', o.id, 'text', o.option_text) order by random())
         from public.ad_question_options o
        where o.question_id = q.id),
      '[]'::jsonb
    ),
    coalesce(
      (select jsonb_agg(jsonb_build_object(
                'dependsOn', r.depends_on_question_id,
                'optionId',  r.option_id,
                'valueText', r.value_text,
                'negate',    r.negate))
         from public.ad_question_rules r
        where r.question_id = q.id),
      '[]'::jsonb
    )
  from public.ad_questions q
  where q.ad_id = p_ad_id
  order by q.position;
$$;

comment on function public.get_ad_questions_for_user(uuid) is
  'Every question on an ad with its cue point, shuffled options and skip-logic rules. is_correct and correct_answer are absent from the return type by construction.';

revoke execute on function public.get_ad_questions_for_user(uuid)
  from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- submit_ad_answers — grade the questions that were actually asked
-- ---------------------------------------------------------------------------

create or replace function public.submit_ad_answers(
  p_user_id  uuid,
  p_ad_id    uuid,
  p_answers  jsonb
)
returns public.ad_answer_result
language plpgsql
security definer
set search_path = ''
as $$
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

  /*
    Only the questions these answers make visible are required or graded.
    Recomputed here from the submitted answers — a client that decides for
    itself which questions to skip decides nothing that matters.
  */
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
      null;  -- opinion question: any answer accepted, and recorded
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

  -- An ad that has questions but shows none is a broken configuration, not a
  -- free credit. (The backward-only rule trigger makes it near-impossible:
  -- the first question can carry no rules, so it is always visible.)
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
  v_points := greatest(floor(v_ad.points_reward * v_tier.reward_multiplier)::bigint, 1);

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
      'ad', p_ad_id::text,
      jsonb_build_object(
        'ad_title',          v_ad.title,
        'base_points',       v_ad.points_reward,
        'tier_slug',         v_tier.slug,
        'tier_multiplier',   v_tier.reward_multiplier,
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
$$;

comment on function public.submit_ad_answers(uuid, uuid, jsonb) is
  'Grades an ad and credits or locks, in one transaction. Requires and grades only the questions the submitted answers make VISIBLE (skip logic), and only those with an answer key. An ad with no questions is credited on watch time alone.';

revoke execute on function public.submit_ad_answers(uuid, uuid, jsonb)
  from public, anon, authenticated;
