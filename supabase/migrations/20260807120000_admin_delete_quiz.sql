-- ============================================================================
-- Migration 136 — a quiz can be removed again
--
-- Migration 123 gave the admin surface `admin_save_quiz` and
-- `admin_delete_quiz_question`, but no way to delete a QUIZ. So a checkpoint
-- added to the wrong video, or at the wrong second, was permanent — the only
-- remedy was deleting every question inside it and leaving an empty quiz
-- behind, which `lesson_is_ready` then refuses to publish:
--
--     'A quiz lesson needs a quiz'   — for a quiz lesson
--
-- ...or worse, on a VIDEO lesson, an empty checkpoint that passes every check
-- and stops the video dead at a question the learner cannot answer, because
-- there are none. Migration 119's rule is that every in-video quiz must be
-- passed before the lesson counts, and a quiz with no questions can never be
-- passed. That is an unfinishable course.
--
-- Found while building the editor: the delete control had nothing to call.
-- ============================================================================

create or replace function public.admin_delete_quiz(p_admin_id uuid, p_quiz_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text;
  v_lesson uuid;
begin
  perform public.assert_admin(p_admin_id);

  select lesson_id into v_lesson from public.quizzes where id = p_quiz_id;
  if not found then
    raise exception 'Unknown quiz' using errcode = 'check_violation';
  end if;

  /* Questions and options go with it by cascade. Attempt history does NOT —
     `submit_quiz_attempt` records a score against the learner's progress, not
     against the quiz row, so deleting a checkpoint cannot retroactively
     un-pass a lesson somebody has already completed. */
  delete from public.quizzes where id = p_quiz_id;

  select u.email::text into v_email from auth.users u where u.id = p_admin_id;
  insert into public.admin_audit_log
    (actor_id, actor_email, action, entity_type, entity_id, old_values)
  values (p_admin_id, v_email, 'delete', 'quizzes', p_quiz_id,
          jsonb_build_object('lesson_id', v_lesson));
end;
$$;

revoke execute on function public.admin_delete_quiz(uuid, uuid) from public, anon, authenticated;
grant  execute on function public.admin_delete_quiz(uuid, uuid) to service_role;
