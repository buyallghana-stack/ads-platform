-- ============================================================================
-- Migration 038 — What the ads tab needs: thumbnails, question cue points,
-- watch-only ads, and one feed query.
--
-- The earning loop (migration 011) already grades and credits. Three things
-- were missing before a user-facing screen could exist:
--
--   1. A thumbnail. Every card in the feed needs one and the advertiser
--      supplies it, so it belongs on the ad, not on the client.
--
--   2. A cue point per question. The operator's requirement is that an
--      attention question is NOT automatically an end-of-video quiz — the
--      admin decides at which second each one interrupts, and may add as
--      many as they want. That is one nullable column: show_at_seconds.
--      Null keeps the old behaviour (ask at the end).
--
--   3. Ads with no question at all. The admin/advertiser may decide a spot
--      is watch-only. submit_ad_answers refused those outright
--      ('This ad has no question configured'), so such an ad could be served
--      and never paid. Fixed here — with the watch requirement tightened,
--      because on a watch-only ad elapsed time is the ONLY proof of
--      attention there is.
--
-- Plus get_ad_feed(): the whole feed in one round trip, on the hot path (§8).
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. Thumbnails
-- ---------------------------------------------------------------------------
--
-- An object path in the `ad-media` bucket created below, not a URL: the same
-- decision as profiles.avatar_path. Storing a URL would bake the project host
-- into every row and break on a project move.
--
-- Nullable because a YouTube ad can fall back to YouTube's own still, and a
-- survey has no natural image — the client renders a generated cover in both
-- cases rather than a broken image.

alter table public.ads
  add column thumbnail_path text;

comment on column public.ads.thumbnail_path is
  'Object path in the ad-media bucket, supplied by the advertiser. Null falls back to the YouTube still (video) or a generated cover (survey).';


-- ---------------------------------------------------------------------------
-- 2. Question cue points
-- ---------------------------------------------------------------------------

alter table public.ad_questions
  add column show_at_seconds int
    check (show_at_seconds is null or show_at_seconds >= 0);

comment on column public.ad_questions.show_at_seconds is
  'Second of the video at which this question interrupts playback. Null = ask at the end. Ignored for surveys, which have no timeline. Admin-set; an ad may carry as many cues as the admin wants.';

-- Ordering the cue points is what the player does on every video, and it is
-- the same shape the admin editor lists them in.
create index ad_questions_ad_cue_idx
  on public.ad_questions (ad_id, show_at_seconds nulls last, position);


-- ---------------------------------------------------------------------------
-- 3. ad-media bucket
-- ---------------------------------------------------------------------------
--
-- Public read: a thumbnail is shown to every user in the feed, and serving it
-- through the public endpoint keeps it off the authenticated storage API on a
-- slow connection. Nothing private is ever stored here.
--
-- Writes are admin-only. There is no advertiser portal (§1), so the only
-- legitimate writer is an operator uploading what an advertiser sent.
--
-- Note the SELECT policy as well as the write ones: without it
-- storage.remove() silently no-ops through the authenticated API, deleting
-- nothing while reporting success. That cost a real bug on `avatars`.

insert into storage.buckets (id, name, public)
values ('ad-media', 'ad-media', true)
on conflict (id) do nothing;

create policy "Admins read ad media"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'ad-media' and public.is_admin());

create policy "Admins upload ad media"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'ad-media' and public.is_admin());

create policy "Admins update ad media"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'ad-media' and public.is_admin())
  with check (bucket_id = 'ad-media' and public.is_admin());

create policy "Admins delete ad media"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'ad-media' and public.is_admin());


-- ---------------------------------------------------------------------------
-- 4. get_ad_questions_for_user — every question of an ad, answers absent
-- ---------------------------------------------------------------------------
--
-- The per-position get_ad_question_for_user() (migration 008) stays for the
-- admin preview path. The player needs them all at once: a video must know
-- its cue points before playback starts, and a survey renders as a stepper.
--
-- Same security property, for the same reason: is_correct and correct_answer
-- are structurally absent from the return type, so no careless application
-- code can leak the key. Options shuffle on every call (§6.2); questions do
-- not — their order is the admin's timeline.
--
-- Revoked from authenticated like its sibling. The application calls it with
-- the service client only after register_ad_view() has started the clock, so
-- questions cannot be harvested ahead of watching.

create or replace function public.get_ad_questions_for_user(p_ad_id uuid)
returns table (
  question_id     uuid,
  -- Not `position`: that is a reserved word in a RETURNS TABLE column list.
  question_index  int,
  show_at_seconds int,
  question_text   text,
  answer_format   public.answer_format,
  option_id       uuid,
  option_text     text
)
language sql
stable
security definer
set search_path = ''
as $$
  select q.id, q.position, q.show_at_seconds, q.question_text, q.answer_format,
         o.id, o.option_text
  from public.ad_questions q
  left join public.ad_question_options o on o.question_id = q.id
  where q.ad_id = p_ad_id
  -- Questions in the admin's order; options shuffled within each question.
  order by q.position, random();
$$;

comment on function public.get_ad_questions_for_user(uuid) is
  'Every question on an ad with its cue point and shuffled options. is_correct and correct_answer are absent from the return type by construction.';

revoke execute on function public.get_ad_questions_for_user(uuid)
  from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 5. get_ad_feed — the ads tab in one round trip
-- ---------------------------------------------------------------------------
--
-- Wraps the eligibility rules of get_eligible_ads and adds what a card has to
-- render: the thumbnail, how many questions are coming, how many attempts the
-- user has left, and the points they will ACTUALLY be paid (base x their tier
-- multiplier, floored exactly as submit_ad_answers does it). Showing the base
-- reward to a Gold subscriber would understate what they earn.
--
-- Ordering differs from get_eligible_ads on purpose. That function reshuffles
-- on every call, which is right for serving one ad and wrong for a feed: cards
-- would jump between two renders of the same screen. Here the weighted draw is
-- seeded from user + ad + UTC day, so the order is stable for one user for one
-- day, different for the next user, and refreshed tomorrow — while still
-- honouring the serving weight.
--
-- SECURITY DEFINER because it counts rows in ad_questions, which is admin-only
-- (a count reveals no answer). Guarded like get_user_earning_status: a
-- signed-in caller may only ask about themselves.

create or replace function public.get_ad_feed(
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
begin
  if v_caller is not null and v_caller <> p_user_id and not public.is_admin() then
    raise exception 'Not authorised to read another user''s ad feed'
      using errcode = 'insufficient_privilege';
  end if;

  v_tier := public.resolve_user_tier(p_user_id);

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
  -- Weighted draw, seeded so one user sees one stable order for one UTC day.
  order by
    -ln(
      -- hashtextextended lives in pg_catalog, which stays on the search path
      -- even when it is set to '' — no schema qualification needed.
      (abs(hashtextextended(
             p_user_id::text || a.id::text || public.utc_today()::text, 0
           )) % 1000000 + 1)::numeric / 1000001.0
    ) / a.weight
  limit greatest(p_limit, 1);
end;
$$;

comment on function public.get_ad_feed(uuid, public.ad_format, int) is
  'The ads tab in one call: eligible ads for a user, optionally one format, with thumbnail, question count, attempts left and the tier-adjusted points they will be paid. Stable order per user per UTC day.';

revoke execute on function public.get_ad_feed(uuid, public.ad_format, int)
  from public, anon;

-- Granted explicitly rather than relying on the implicit PUBLIC grant that the
-- revoke above just removed. The page reads this through the RLS user client:
-- the guard inside the function is the check, so no service key is needed on
-- a read that runs on every visit to the tab.
grant execute on function public.get_ad_feed(uuid, public.ad_format, int)
  to authenticated, service_role;


-- ---------------------------------------------------------------------------
-- 6. submit_ad_answers — watch-only ads
-- ---------------------------------------------------------------------------
--
-- Only two things change from migration 011, both around the question count:
--
--   * The count is taken BEFORE the watch check, because it decides what the
--     watch requirement is.
--
--   * Zero questions is now a valid ad rather than a configuration error. The
--     user is credited for watching, and the watch requirement becomes
--     min_watch_seconds, or the full duration when the admin set no minimum.
--     On an ad with a question, a lenient minimum is fine — the question is
--     the real gate (§3). On a watch-only ad there is no second gate, so
--     falling back to 0 would pay out the instant the ad opened. Falling back
--     to the full duration is the honest reading of "watch this".
--
-- Everything else — the re-watch rule, the attempt accounting, the completion
-- slot claimed before crediting, the cap/kill-switch rollback that consumes no
-- attempt — is unchanged and deliberately re-stated in full rather than
-- patched, so the money path can be read in one piece.

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
  v_all_correct boolean := true;
  v_qcount      int := 0;
  v_first_q     uuid;
  v_points      bigint;
  v_entry       public.points_ledger;
  v_balance     bigint;
begin
  v_retry_cap := public.config_int('ad_retry_cap')::int;

  -- Lock the user's row for this ad. Two simultaneous submissions for the same
  -- ad must not both consume an attempt or both credit.
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

  -- Re-watch gate: a wrong answer cleared this stamp.
  if v_state.watch_started_at is null then
    return row('not_watched', 0, v_state.attempts_used,
               greatest(v_retry_cap - v_state.attempts_used, 0), null,
               'Watch the ad again before answering.')::public.ad_answer_result;
  end if;

  -- The ad must still be live. It may have been paused or exhausted while the
  -- user was watching.
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

  -- Server-side watch time. Client-reported duration is never consulted.
  -- On a watch-only ad the clock is the only gate, so an unset minimum means
  -- the whole video rather than nothing.
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

  -- Grade every question on the ad. All must be correct. A watch-only ad has
  -- nothing to grade and the loop simply does not run.
  for v_q in
    select q.id, q.answer_format, q.correct_answer
      from public.ad_questions q
     where q.ad_id = p_ad_id
     order by q.position
  loop
    if v_first_q is null then v_first_q := v_q.id; end if;

    v_submitted := p_answers ->> v_q.id::text;

    if v_submitted is null then
      v_all_correct := false;
    elsif v_q.answer_format = 'multiple_choice' then
      -- The submitted value is an option id. Checked against the database, so
      -- the correct id never has to leave it.
      select exists (
        select 1 from public.ad_question_options o
         where o.question_id = v_q.id
           and o.id::text = v_submitted
           and o.is_correct
      ) into v_ok;
      v_all_correct := v_all_correct and v_ok;
    else
      -- Short text: case-insensitive, whitespace-trimmed. An exact-match
      -- comparison would fail honest users over a capital letter.
      v_all_correct := v_all_correct
        and lower(trim(v_submitted)) = lower(trim(v_q.correct_answer));
    end if;
  end loop;

  -- ---------------------------------------------------------------------
  -- Wrong answer
  -- ---------------------------------------------------------------------
  if not v_all_correct then
    update public.user_ad_state
       set attempts_used    = attempts_used + 1,
           watch_started_at = null,   -- forces a re-watch (§6.2)
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
            left(coalesce(p_answers::text, ''), 500), false, floor(v_elapsed)::int);

    if v_state.status = 'failed_locked' then
      return row('locked', 0, v_state.attempts_used, 0, null,
                 'Incorrect. No attempts remaining for this ad.')::public.ad_answer_result;
    end if;

    return row('incorrect', 0, v_state.attempts_used,
               greatest(v_retry_cap - v_state.attempts_used, 0), null,
               'Incorrect. Watch the ad again to retry.')::public.ad_answer_result;
  end if;

  -- ---------------------------------------------------------------------
  -- Correct answer (or a completed watch-only ad)
  -- ---------------------------------------------------------------------
  v_tier := public.resolve_user_tier(p_user_id);

  -- Tier multiplier applied to the admin's per-ad points (§6.2, §6.7).
  -- floor(), not round(): rounding down is predictable and never pays more
  -- than configured. Guaranteed at least one point so a fractional multiplier
  -- cannot silently zero a reward.
  v_points := greatest(floor(v_ad.points_reward * v_tier.reward_multiplier)::bigint, 1);

  -- Claim a completion slot before crediting. The WHERE guard is what stops
  -- two users simultaneously taking the last slot of a budget.
  update public.ads
     set completions_count = completions_count + 1
   where id = p_ad_id
     and (max_completions is null or completions_count < max_completions);

  if not found then
    return row('not_eligible', 0, v_state.attempts_used,
               greatest(v_retry_cap - v_state.attempts_used, 0), null,
               'This ad just reached its limit.')::public.ad_answer_result;
  end if;

  -- credit_points owns the daily cap, cooldown, kill switch and disabled-account
  -- checks. Catching its exception rolls back this subtransaction — including
  -- the completion slot above — so a capped user consumes no attempt and the
  -- ad remains available to them tomorrow.
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
        'question_count',    v_qcount
      ),
      true  -- enforce the daily cap
    );
  exception
    when sqlstate 'P0001' or sqlstate '23514' then
      if sqlerrm like '%Daily cap%' or sqlerrm like '%Cooldown%' then
        return row('daily_cap_reached', 0, v_state.attempts_used,
                   greatest(v_retry_cap - v_state.attempts_used, 0), null,
                   sqlerrm)::public.ad_answer_result;
      end if;
      return row('earning_blocked', 0, v_state.attempts_used,
                 greatest(v_retry_cap - v_state.attempts_used, 0), null,
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
          left(coalesce(p_answers::text, ''), 500), true, floor(v_elapsed)::int);

  select balance into v_balance from public.user_balances where user_id = p_user_id;

  return row('correct', v_points, v_state.attempts_used, 0, v_balance,
             format('%s points added.', v_points))::public.ad_answer_result;
end;
$$;

comment on function public.submit_ad_answers(uuid, uuid, jsonb) is
  'Grades an ad''s questions and credits or locks, in one transaction. All questions must be correct. An ad with no questions is credited on watch time alone, which then defaults to the full duration. A failure that is not the user''s fault (cap, kill switch, ad exhausting) consumes no attempt.';

revoke execute on function public.submit_ad_answers(uuid, uuid, jsonb)
  from public, anon, authenticated;
