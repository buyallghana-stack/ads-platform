-- ============================================================================
-- Migration 131 — everything the lesson player needs, in one read
--
-- The player opens a lesson and immediately needs: the lesson itself, its
-- resources, the learner's position in it, and — for a video — every in-video
-- quiz with its questions and options so a checkpoint can fire at the right
-- second without a network round trip mid-playback.
--
-- That last point is the reason this is one function rather than four calls.
-- A quiz that has to be fetched when the playhead reaches 4:32 will arrive
-- late on a slow connection, and "late" here means the video plays past the
-- checkpoint. The whole set is loaded up front, and the player fires from
-- memory.
--
-- ---------------------------------------------------------------------------
-- THE ANSWER KEY NEVER LEAVES THE DATABASE
--
-- Options are returned WITHOUT `is_correct`. Passing a quiz can complete a
-- lesson, completing lessons crosses the activation threshold, and crossing it
-- makes somebody an affiliate who can earn real money. A quiz marked in the
-- browser would be a browser-granted right to earn.
--
-- `submit_quiz_attempt` does the marking. This function only ever asks.
--
-- ---------------------------------------------------------------------------
-- ENTITLEMENT IS CHECKED HERE TOO
--
-- `src/lib/content/access.ts` checks entitlement before signing a media URL,
-- but an ARTICLE lesson has no media — its whole content is `body`, returned
-- inline. Without a check here, the text of every paid article would be
-- readable by anyone who could reach this function. Preview lessons skip the
-- check, which is what makes them previews.
-- ============================================================================

create or replace function public.lesson_for_learner(p_user_id uuid, p_lesson_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_lesson     public.lessons;
  v_product_id uuid;
  v_section    text;
  v_allowed    boolean;
begin
  select l.* into v_lesson from public.lessons l where l.id = p_lesson_id;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not-found');
  end if;

  select s.product_id, s.title into v_product_id, v_section
    from public.course_sections s
   where s.id = v_lesson.section_id;

  v_allowed := v_lesson.is_preview or public.has_entitlement(p_user_id, v_product_id);
  if not v_allowed then
    return jsonb_build_object('ok', false, 'reason', 'locked');
  end if;

  return jsonb_build_object(
    'ok', true,
    'lesson', jsonb_build_object(
      'id',            v_lesson.id,
      'title',         v_lesson.title,
      'kind',          v_lesson.kind::text,
      'section_title', v_section,
      'product_id',    v_product_id,
      'duration_seconds', v_lesson.duration_seconds,
      'is_preview',    v_lesson.is_preview,
      -- Only for the kinds whose content IS text. A video's `body` is a
      -- transcript or note, and sending it for every kind would put the
      -- article text on the wire for lessons that never display it.
      'body', case when v_lesson.kind in ('article', 'pdf') then v_lesson.body else null end
    ),
    'progress', coalesce((
      select jsonb_build_object(
               'seconds_watched', lp.seconds_watched,
               'watched_percent', lp.watched_percent,
               'quiz_passed',     lp.quiz_passed,
               'completed',       lp.completed_at is not null
             )
        from public.lesson_progress lp
       where lp.user_id = p_user_id and lp.lesson_id = p_lesson_id
    ), jsonb_build_object(
         'seconds_watched', 0, 'watched_percent', 0,
         'quiz_passed', false, 'completed', false
       )),
    'resources', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', r.id, 'title', r.title, 'byte_size', r.byte_size
             ) order by r.position)
        from public.lesson_resources r
       where r.lesson_id = p_lesson_id
    ), '[]'::jsonb),
    /*
      Quizzes, each with its questions and options. `at_seconds` null means a
      standalone section quiz; a number means a checkpoint inside the video.
      Ordered by at_seconds so the player can walk the list forwards as the
      playhead advances rather than searching it every tick.
    */
    'quizzes', coalesce((
      select jsonb_agg(q order by q->>'at_seconds' nulls first)
        from (
          select jsonb_build_object(
                   'id',           z.id,
                   'title',        z.title,
                   'at_seconds',   z.at_seconds,
                   'pass_percent', z.pass_percent,
                   'questions', coalesce((
                     select jsonb_agg(jsonb_build_object(
                              'id',      qq.id,
                              'prompt',  qq.prompt,
                              'options', coalesce((
                                select jsonb_agg(jsonb_build_object(
                                         'id',   qo.id,
                                         'body', qo.body
                                       ) order by qo.position)
                                  from public.quiz_options qo
                                 where qo.question_id = qq.id
                              ), '[]'::jsonb)
                            ) order by qq.position)
                       from public.quiz_questions qq
                      where qq.quiz_id = z.id
                   ), '[]'::jsonb)
                 ) as q
            from public.quizzes z
           where z.lesson_id = p_lesson_id
        ) s
    ), '[]'::jsonb)
  );
end;
$$;

-- Server-only, like every Phase 2 read. ⚠️ `create or replace` re-grants to
-- PUBLIC; without the revoke, the anon key could read paid article text.
revoke execute on function public.lesson_for_learner(uuid, uuid) from public, anon, authenticated;
grant  execute on function public.lesson_for_learner(uuid, uuid) to service_role;
