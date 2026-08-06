-- ============================================================================
-- Migration 135 — the lesson editor's read
--
-- `lesson_for_learner` deliberately strips the answer key. The editor is the
-- one place that must SEE it — you cannot mark an option correct on a screen
-- that does not know which one is — so it needs its own read rather than a flag
-- on the learner's.
--
-- Two functions, not one with a `p_include_answers` boolean, on purpose. A
-- boolean that switches the answer key on is one wrong argument away from
-- shipping the answers to a learner, and it would sit in a function that IS
-- reachable by learners. Two functions with different grants cannot make that
-- mistake: `lesson_for_learner` has no code path that returns `is_correct`, and
-- this one is only callable by the service role behind an admin check.
-- ============================================================================

create or replace function public.admin_lesson_detail(p_admin_id uuid, p_lesson_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_lesson  public.lessons;
  v_section public.course_sections;
begin
  perform public.assert_admin(p_admin_id);

  select * into v_lesson from public.lessons where id = p_lesson_id;
  if not found then
    return jsonb_build_object('ok', false);
  end if;

  select * into v_section from public.course_sections where id = v_lesson.section_id;

  return jsonb_build_object(
    'ok', true,
    'lesson', jsonb_build_object(
      'id',              v_lesson.id,
      'sectionId',       v_lesson.section_id,
      'sectionTitle',    v_section.title,
      'productId',       v_section.product_id,
      'title',           v_lesson.title,
      'kind',            v_lesson.kind::text,
      'body',            v_lesson.body,
      'storagePath',     v_lesson.storage_path,
      'durationSeconds', v_lesson.duration_seconds,
      'isPreview',       v_lesson.is_preview,
      'position',        v_lesson.position
    ),
    -- What still stands between this lesson and being publishable. The same
    -- string the catalogue and the product editor show, so the operator is
    -- never told two different things about one lesson.
    'problem', public.lesson_is_ready(p_lesson_id),
    'resources', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', r.id, 'title', r.title,
               'storagePath', r.storage_path, 'byteSize', r.byte_size,
               'position', r.position
             ) order by r.position)
        from public.lesson_resources r where r.lesson_id = p_lesson_id
    ), '[]'::jsonb),
    'quizzes', coalesce((
      select jsonb_agg(q order by q->>'atSeconds' nulls first)
        from (
          select jsonb_build_object(
                   'id',          z.id,
                   'title',       z.title,
                   'atSeconds',   z.at_seconds,
                   'passPercent', z.pass_percent,
                   'position',    z.position,
                   'questions', coalesce((
                     select jsonb_agg(jsonb_build_object(
                              'id',          qq.id,
                              'prompt',      qq.prompt,
                              'explanation', qq.explanation,
                              'position',    qq.position,
                              'options', coalesce((
                                select jsonb_agg(jsonb_build_object(
                                         'id',        qo.id,
                                         'body',      qo.body,
                                         -- THE ANSWER KEY. Present here and
                                         -- nowhere a learner can reach.
                                         'isCorrect', qo.is_correct
                                       ) order by qo.position)
                                  from public.quiz_options qo
                                 where qo.question_id = qq.id
                              ), '[]'::jsonb)
                            ) order by qq.position)
                       from public.quiz_questions qq where qq.quiz_id = z.id
                   ), '[]'::jsonb)
                 ) as q
            from public.quizzes z where z.lesson_id = p_lesson_id
        ) s
    ), '[]'::jsonb)
  );
end;
$$;

-- ⚠️ `create or replace` re-grants EXECUTE to PUBLIC, and this one returns the
-- answer key. Revoking is the whole security of the quiz.
revoke execute on function public.admin_lesson_detail(uuid, uuid) from public, anon, authenticated;
grant  execute on function public.admin_lesson_detail(uuid, uuid) to service_role;
