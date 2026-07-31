-- ============================================================================
-- Migration 090 — link ads: read an article, click through, get paid
--
-- Operator's brief, 2026-07-31: the card looks like a video or survey card
-- (thumbnail, title, points). Opening it shows something the admin wrote — an
-- article or a description — which the user reads. At the end there is a link
-- out to the advertiser's site or app, and the user is free to do whatever the
-- advertiser is asking for. "What matters to me is that was the link clicked
-- if yes the system will automatically award them with the deserved point."
--
-- ---------------------------------------------------------------------------
-- NO NEW MONEY PATH. THIS IS THE IMPORTANT DECISION IN THE FILE.
-- ---------------------------------------------------------------------------
-- `record_ad_link_click` records the click and then calls the SAME
-- `submit_ad_answers` that pays for a video, with an empty answer set. That is
-- not a shortcut, it is the only responsible option: that function already
-- carries the daily ad cap, the points cap, the cooldown, the global earning
-- pause, the disabled-account refusal, the retry ceiling, the completion
-- counter and the double-credit guard. A second crediting path would have to
-- reproduce all nine and would drift from the first one within a month.
--
-- It works because of a property migration 038 already gave it: an ad with
-- ZERO questions credits on watch time alone, where the requirement is
-- `min_watch_seconds`. A link ad has no questions, so `min_watch_seconds`
-- becomes the number of seconds the article must be open before the link will
-- pay — which is the only brake this format has, and the reason it is not
-- optional below.
--
-- ---------------------------------------------------------------------------
-- WHAT MAKES THIS FORMAT EASIER TO FARM THAN THE OTHER TWO, said plainly
-- ---------------------------------------------------------------------------
-- A video makes somebody sit through it and answer a question about it. A
-- survey makes them type. A link ad asks for one tap. There is no way to
-- observe whether the person read the article, and no way at all to observe
-- whether they did what the advertiser wanted once they left — the operator
-- knows this and has accepted it ("they are at liberty to do the service the
-- link asked for"). So the defences are: the dwell time before a click counts,
-- one payment per person per ad for all time (the existing ledger index), and
-- the daily caps that apply to every format. `link_dwell_seconds_default`
-- exists so the operator can raise the floor for every future ad at once
-- rather than editing them one at a time.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. The article, and the shape a link ad must have
-- ---------------------------------------------------------------------------

alter table public.ads
  add column if not exists article_body text;

comment on column public.ads.article_body is
  'The piece the user reads before the link. Link ads only — a video says what it has to say in the video.';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ads_article_body_length') then
    alter table public.ads
      add constraint ads_article_body_length
      check (article_body is null or length(btrim(article_body)) between 40 and 8000);
  end if;
end $$;

/*
  `ads_video_shape` decided what each format may carry, and its CASE ended in
  `else null`. A CHECK that evaluates to NULL PASSES — so a row with the new
  format would have been accepted with no shape rules whatsoever: a link ad
  carrying a video file, or carrying nothing at all. Restated with the third
  branch written out, and the else made explicit rather than silent.
*/
alter table public.ads drop constraint if exists ads_video_shape;
alter table public.ads add constraint ads_video_shape check (
  case format
    when 'video' then
      video_source is not null
      and (
        (video_source = 'upload' and storage_path is not null and youtube_video_id is null)
        or (video_source = 'youtube' and youtube_video_id is not null and storage_path is null)
      )
    when 'survey' then
      video_source is null and storage_path is null and youtube_video_id is null
    when 'link' then
      video_source is null and storage_path is null and youtube_video_id is null
      -- The article and the destination are the format. Without either there
      -- is nothing to read and nowhere to go.
      and article_body is not null
      and jsonb_array_length(cta_links) = 1
      -- The dwell time is the only thing standing between this format and a
      -- tap-for-points button, so it is required rather than defaulted.
      and min_watch_seconds is not null and min_watch_seconds >= 3
    else false
  end
);

/*
  A call to action was video-only, and a survey is still forbidden one — asking
  a respondent to go shopping mid-questionnaire changes what their answers
  mean. A link ad IS a call to action, so it is allowed exactly one.
*/
alter table public.ads drop constraint if exists ads_cta_video_only;
alter table public.ads add constraint ads_cta_video_or_link check (
  format in ('video', 'link')
  or (cta_links = '[]'::jsonb and cta_label is null)
);

/* A link ad has nothing to ask about: there is no video to have watched and
   no questionnaire to answer, and a question would have no bearing on whether
   the link was clicked. */
create or replace function public.no_questions_on_link_ads()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.ads a where a.id = new.ad_id and a.format = 'link') then
    raise exception 'A link ad cannot carry questions' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists ad_questions_not_on_link_ads on public.ad_questions;
create trigger ad_questions_not_on_link_ads
  before insert or update on public.ad_questions
  for each row execute function public.no_questions_on_link_ads();


-- ---------------------------------------------------------------------------
-- 2. How long the article must be open before a click pays
-- ---------------------------------------------------------------------------

insert into public.app_config
  (key, value, value_type, min_value, max_value, is_public, description)
values
  ('link_dwell_seconds_default', '15', 'int', 3, 600, true,
   'The reading time a new link ad starts with, in seconds, before its link will pay. Each ad can override it. This is the only brake on the format: a link ad asks for one tap, and without a floor it is a button that prints points.')
on conflict (key) do nothing;


-- ---------------------------------------------------------------------------
-- 3. The click itself
-- ---------------------------------------------------------------------------
--
-- Recorded separately from the payment because it answers a different
-- question. The ledger says who was paid; this says who went to the
-- advertiser, which is the number the advertiser is buying and the evidence
-- behind an invoice. One row per person per ad: a second tap is the same
-- visit, and the unique constraint says so rather than the application
-- remembering to.

create table if not exists public.ad_link_clicks (
  id uuid primary key default gen_random_uuid(),
  ad_id   uuid not null references public.ads (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  clicked_at timestamptz not null default now(),
  -- What the click was worth, frozen: re-pricing the ad later must not rewrite
  -- what this visit earned.
  points_awarded bigint not null default 0 check (points_awarded >= 0),
  constraint ad_link_clicks_once unique (ad_id, user_id)
);

create index if not exists ad_link_clicks_ad_idx on public.ad_link_clicks (ad_id, clicked_at desc);
create index if not exists ad_link_clicks_user_idx on public.ad_link_clicks (user_id, clicked_at desc);

alter table public.ad_link_clicks enable row level security;

create policy "Read own link clicks or all as admin"
  on public.ad_link_clicks for select
  to authenticated
  using ((select auth.uid()) = user_id or public.is_admin());


create or replace function public.record_ad_link_click(p_user_id uuid, p_ad_id uuid)
returns public.ad_answer_result
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ad     public.ads;
  v_result public.ad_answer_result;
begin
  select * into v_ad from public.ads where id = p_ad_id;
  if not found or v_ad.format <> 'link' then
    raise exception 'Not a link ad' using errcode = 'check_violation';
  end if;

  /*
    THE PAYMENT IS `submit_ad_answers`, unchanged and unbypassed. It decides
    whether the dwell time has elapsed, whether the daily caps allow it,
    whether earning is paused, whether this person has already been paid for
    this ad, and it writes the ledger row and the counters. Everything below
    is bookkeeping around a decision made there.
  */
  v_result := public.submit_ad_answers(p_user_id, p_ad_id, '[]'::jsonb);

  /*
    The visit is recorded whatever the answer, because it happened — somebody
    who clicks through a second time, or too fast, or after the daily cap, has
    still been delivered to the advertiser. `on conflict do nothing` keeps it
    at one row per person, and only a paying click carries the points.
  */
  insert into public.ad_link_clicks (ad_id, user_id, points_awarded)
  values (p_ad_id, p_user_id, case when v_result.outcome = 'credited' then v_result.points_awarded else 0 end)
  on conflict (ad_id, user_id) do update
    set points_awarded = greatest(public.ad_link_clicks.points_awarded, excluded.points_awarded);

  return v_result;
end;
$$;

comment on function public.record_ad_link_click(uuid, uuid) is
  'Records a click through to the advertiser and pays for it through submit_ad_answers — the same function that pays for a video, so every cap, cooldown and double-credit guard applies unchanged.';

revoke execute on function public.record_ad_link_click(uuid, uuid)
  from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 4. The feed carries the article
-- ---------------------------------------------------------------------------
--
-- Drop and recreate: the return type gains a column. The body travels with the
-- feed rather than waiting for a second call — it is a few hundred words, the
-- tab already fetches everything it shows in one round trip, and a spinner
-- between tapping a card and reading it is the thing that makes a cheap phone
-- feel broken.

-- GENERATED FROM THE LIVE DEFINITION, not retyped: one column added to the
-- return type and one expression to the select list, everything else exactly
-- as `pg_get_functiondef` returned it. The targeting rules in this function
-- are long and load-bearing, and the last time somebody retyped a function
-- from a partial read (migration 081) three guards disappeared with it.

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
  v_inclusive boolean := public.config_bool('ad_targeting_includes_lower_tiers');
  v_tier_ids  uuid[];
  v_rank      int;
begin
  if v_caller is not null and v_caller <> p_user_id and not public.is_admin() then
    raise exception 'Not authorised to read another user''s ad feed'
      using errcode = 'insufficient_privilege';
  end if;

  v_tier := public.resolve_user_tier(p_user_id);

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
    greatest(v_retry_cap - coalesce(s.attempts_used, 0), 0),
    a.cta_label,
    a.cta_links,
    a.article_body
  from public.ads a
  left join public.user_ad_state s
    on s.user_id = p_user_id and s.ad_id = a.id
  where a.status = 'active'
    and (p_format is null or a.format = p_format)
    and (a.starts_at is null or a.starts_at <= now())
    and (a.ends_at   is null or a.ends_at   >  now())
    and (a.max_completions is null or a.completions_count < a.max_completions)
    and coalesce(s.status, 'in_progress') not in ('completed', 'failed_locked')
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
    )
  order by
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
