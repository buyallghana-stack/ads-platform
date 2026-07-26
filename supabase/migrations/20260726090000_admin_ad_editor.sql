-- ============================================================================
-- Migration 047 — what the ad editor needs to exist
--
-- Migration 046 gave the admin dashboard a way to WRITE an ad
-- (admin_save_ad) and a way to LIST the pool (admin_list_ads). Building the
-- actual screen turned up three things missing between them.
--
-- 1. There was no way to READ one ad back for editing. get_ad_questions_for_
--    user is the player's view and deliberately omits the answer key, which
--    is exactly what an editor has to show. admin_get_ad returns the whole
--    thing — questions, options with is_correct, branching rules, targeting —
--    in the SAME SHAPE admin_save_ad accepts, so an ad round-trips through
--    the form without a translation layer that can drift.
--
--    Rules come back referencing questions and options BY INDEX for that
--    reason: that is how admin_save_ad takes them, and an editor that loads
--    ids but saves indexes is an editor with two models of the same thing.
--
-- 2. Changing only the status had no safe call. admin_save_ad's update path
--    writes every column from the payload, so a "pause this ad" that sent
--    {id, status} would blank the video source, the thumbnail, the schedule
--    and the budget. Pausing from a row in a list must not be able to do
--    that, so status gets its own function.
--
-- 3. admin_list_ads could not tell the screen whether an ad may be DELETED.
--    admin_delete_ad hard-deletes only while nobody has attempted the ad and
--    archives otherwise, and the operator's rule is that an action which
--    cannot succeed is absent rather than disabled — so the list needs the
--    attempt count to decide which of the two verbs to offer.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. admin_get_ad — one ad, in the shape the editor saves back
-- ---------------------------------------------------------------------------

create or replace function public.admin_get_ad(p_admin_id uuid, p_ad_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_ad        jsonb;
  v_questions jsonb;
  -- question id -> its 0-based index in the ad, and option id -> its 0-based
  -- index within its own question. Built once, then used to express every
  -- rule the way admin_save_ad expects to receive it.
  v_qindex    jsonb;
  v_oindex    jsonb;
begin
  perform public.assert_admin(p_admin_id);

  select coalesce(jsonb_object_agg(s.id::text, s.ix - 1), '{}'::jsonb)
    into v_qindex
  from (
    select q.id, row_number() over (order by q.position, q.created_at) as ix
      from public.ad_questions q
     where q.ad_id = p_ad_id
  ) s;

  select coalesce(jsonb_object_agg(s.id::text, s.ix - 1), '{}'::jsonb)
    into v_oindex
  from (
    select o.id,
           row_number() over (
             partition by o.question_id order by o.sort_order, o.created_at
           ) as ix
      from public.ad_question_options o
      join public.ad_questions q on q.id = o.question_id
     where q.ad_id = p_ad_id
  ) s;

  select coalesce(jsonb_agg(s.payload order by s.ord), '[]'::jsonb)
    into v_questions
  from (
    select
      row_number() over (order by q.position, q.created_at) as ord,
      jsonb_build_object(
        'question_text',   q.question_text,
        'answer_format',   q.answer_format,
        'correct_answer',  q.correct_answer,
        'show_at_seconds', q.show_at_seconds,
        'condition_mode',  q.condition_mode,
        'options', coalesce((
          select jsonb_agg(
                   jsonb_build_object('option_text', o.option_text, 'is_correct', o.is_correct)
                   order by o.sort_order, o.created_at)
            from public.ad_question_options o
           where o.question_id = q.id
        ), '[]'::jsonb),
        'rules', coalesce((
          select jsonb_agg(
                   jsonb_build_object(
                     'depends_on_index', (v_qindex ->> r.depends_on_question_id::text)::int,
                     'option_index',     case when r.option_id is null then null
                                              else (v_oindex ->> r.option_id::text)::int end,
                     'value_text',       r.value_text,
                     'negate',           r.negate)
                   order by r.created_at)
            from public.ad_question_rules r
           where r.question_id = q.id
        ), '[]'::jsonb)
      ) as payload
      from public.ad_questions q
     where q.ad_id = p_ad_id
  ) s;

  select to_jsonb(a) - 'created_by'
         || jsonb_build_object(
              'attempts_count',
                (select count(*)::int from public.ad_attempts x where x.ad_id = a.id),
              -- Why the form locks its question editor. Same condition
              -- admin_save_ad enforces, reported ahead of the save so the
              -- operator is told rather than finding out by being ignored.
              'questions_locked',
                a.completions_count > 0
                and exists (select 1 from public.ad_questions q where q.ad_id = a.id),
              'tier_ids',
                coalesce((select jsonb_agg(x.tier_id) from public.ad_tiers x where x.ad_id = a.id),
                         '[]'::jsonb),
              'questions', v_questions
            )
    into v_ad
  from public.ads a
  where a.id = p_ad_id;

  if v_ad is null then
    raise exception 'Unknown ad' using errcode = 'check_violation';
  end if;

  return v_ad;
end;
$$;

comment on function public.admin_get_ad(uuid, uuid) is
  'One ad in full for the admin editor — questions with their answer key, options, branching rules by index, and tier targeting — in the same shape admin_save_ad accepts back.';

revoke execute on function public.admin_get_ad(uuid, uuid) from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 2. admin_set_ad_status — pause, resume, archive, without touching anything else
-- ---------------------------------------------------------------------------

create or replace function public.admin_set_ad_status(
  p_admin_id uuid,
  p_ad_id    uuid,
  p_status   public.ad_status
)
returns public.ad_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ad public.ads%rowtype;
begin
  perform public.assert_admin(p_admin_id);

  select * into v_ad from public.ads where id = p_ad_id;
  if not found then
    raise exception 'Unknown ad' using errcode = 'check_violation';
  end if;

  -- Setting a spent ad live again is a no-op with a delay: the auto-exhaust
  -- trigger puts it straight back the next time anybody completes it. Say so
  -- now rather than let the operator watch it flip back on its own.
  if p_status = 'active'
     and v_ad.max_completions is not null
     and v_ad.completions_count >= v_ad.max_completions then
    raise exception 'This ad has already delivered its whole budget. Raise the number of completions before setting it live.'
      using errcode = 'check_violation';
  end if;

  update public.ads
     set status = p_status, updated_at = now()
   where id = p_ad_id;

  return p_status;
end;
$$;

comment on function public.admin_set_ad_status(uuid, uuid, public.ad_status) is
  'Changes only an ad''s status. Separate from admin_save_ad because that function writes every column from its payload, so a status-only save through it would blank the media, schedule and budget.';

revoke execute on function public.admin_set_ad_status(uuid, uuid, public.ad_status)
  from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 3. admin_list_ads — enough for the list screen to offer the right verbs
-- ---------------------------------------------------------------------------
--
-- Adds the media fields the row needs to describe an ad honestly (a 45-second
-- YouTube spot and a 45-second uploaded file are not the same operational
-- thing) and attempts_count, which decides whether this ad can be deleted or
-- only archived.

drop function if exists public.admin_list_ads(public.ad_status);

create function public.admin_list_ads(p_status public.ad_status default null)
returns table (
  id                uuid,
  title             text,
  description       text,
  advertiser_name   text,
  format            public.ad_format,
  status            public.ad_status,
  points_reward     bigint,
  completions_count int,
  max_completions   int,
  attempts_count    int,
  question_count    int,
  graded_count      int,
  branching_count   int,
  cue_count         int,
  tier_slugs        text[],
  video_source      public.video_source,
  duration_seconds  int,
  min_watch_seconds int,
  thumbnail_path    text,
  weight            int,
  starts_at         timestamptz,
  ends_at           timestamptz,
  created_at        timestamptz,
  updated_at        timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  -- Read path: an admin's own browser token, so is_admin() is the check. A
  -- null caller is the service client, already trusted.
  if (select auth.uid()) is not null and not public.is_admin() then
    raise exception 'Not an administrator' using errcode = 'insufficient_privilege';
  end if;

  return query
  select
    a.id, a.title, a.description, a.advertiser_name, a.format, a.status, a.points_reward,
    a.completions_count, a.max_completions,
    (select count(*)::int from public.ad_attempts x where x.ad_id = a.id),
    (select count(*)::int from public.ad_questions q where q.ad_id = a.id),
    (select count(*)::int from public.ad_questions q
      where q.ad_id = a.id
        and (q.correct_answer is not null
             or exists (select 1 from public.ad_question_options o
                         where o.question_id = q.id and o.is_correct))),
    (select count(*)::int from public.ad_question_rules r
      join public.ad_questions q on q.id = r.question_id
     where q.ad_id = a.id),
    (select count(*)::int from public.ad_questions q
      where q.ad_id = a.id and q.show_at_seconds is not null),
    coalesce(
      (select array_agg(t.slug order by t.sort_order)
         from public.ad_tiers x join public.tiers t on t.id = x.tier_id
        where x.ad_id = a.id),
      '{}'::text[]
    ),
    a.video_source, a.duration_seconds, a.min_watch_seconds, a.thumbnail_path, a.weight,
    a.starts_at, a.ends_at, a.created_at, a.updated_at
  from public.ads a
  where p_status is null or a.status = p_status
  order by a.created_at desc;
end;
$$;

comment on function public.admin_list_ads(public.ad_status) is
  'The ad pool for the admin list: delivery, question/graded/branching/cue counts, targeting, media shape, and the attempt count that decides whether an ad can be deleted or only archived.';

revoke execute on function public.admin_list_ads(public.ad_status) from public, anon;
grant execute on function public.admin_list_ads(public.ad_status) to authenticated, service_role;


-- ---------------------------------------------------------------------------
-- 4. ad-media limits
-- ---------------------------------------------------------------------------
--
-- The bucket was created in migration 038 for thumbnails only, with the
-- project defaults. The editor now uploads the in-house video through it too,
-- so it needs a size ceiling that admits a real ad film and a type list that
-- keeps everything else out. 100 MB is generous for a 30-90 second spot and
-- small enough that a mis-drop is refused by the storage API rather than
-- discovered on the bill.

update storage.buckets
   set file_size_limit = 104857600,
       allowed_mime_types = array[
         'video/mp4', 'video/webm', 'video/quicktime',
         'image/jpeg', 'image/png', 'image/webp'
       ]
 where id = 'ad-media';
