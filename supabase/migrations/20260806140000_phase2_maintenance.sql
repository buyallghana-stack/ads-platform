-- ============================================================================
-- Migration 125 — certificates on completion, and the nightly maintenance
--
-- Three jobs that have been buildable since their tables existed and had
-- nothing driving them: issuing a certificate, marking a lapsed entitlement
-- lapsed, and clearing commissions whose hold has passed. Plus the expiry
-- warnings B11e asks for at 30, 7 and 1 days.
--
-- ---------------------------------------------------------------------------
-- A CERTIFICATE IS ISSUED IMMEDIATELY, NOT NIGHTLY
--
-- It hangs off `settle_lesson_completion` rather than the cron below. Somebody
-- finishing the last lesson of a course should see the certificate then, not
-- the next morning — and the moment of completion is already computed there,
-- so the alternative would be recomputing it on a schedule to discover
-- something the database already knew.
--
-- ---------------------------------------------------------------------------
-- ⚠️ THERE IS NO CRON SLOT LEFT, AND THAT IS A REAL CONSTRAINT
--
-- The Vercel plan is Hobby: two cron jobs, daily only. Both are taken —
-- `purge-deletions` at 03:00 and `refresh-fx` at 05:00. So the maintenance
-- below is written as ONE function that does everything and is called from an
-- existing route, rather than as three jobs that cannot be scheduled.
--
-- That is a workaround, not a design. If a third slot ever exists, this should
-- get its own route and its own hour.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Certificates
-- ---------------------------------------------------------------------------

create or replace function public.issue_certificate_if_earned(
  p_user_id uuid,
  p_product_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_enabled bool;
  v_percent int;
  v_id      uuid;
begin
  /* `certificate_enabled` lives on the training program. A vendor course has
     no such row, and there is no decision recorded about certificates for
     those — so it issues none rather than inventing a policy. */
  select tp.certificate_enabled into v_enabled
    from public.training_programs tp where tp.product_id = p_product_id;

  if not coalesce(v_enabled, false) then
    return null;
  end if;

  /* THE WHOLE COURSE, not the activation threshold. Those are different
     claims: the threshold says when somebody may start promoting (B9), a
     certificate says they finished. Issuing at the threshold would hand out a
     certificate for half a course. */
  v_percent := public.training_completion_percent(p_user_id, p_product_id);
  if v_percent < 100 then
    return null;
  end if;

  insert into public.certificates (user_id, product_id, verification_code)
  values (p_user_id, p_product_id, public.generate_certificate_code())
  on conflict (user_id, product_id) do nothing
  returning id into v_id;

  if v_id is not null then
    insert into public.notifications (user_id, type, title, body, reference)
    select p_user_id, 'announcement',
           'Certificate earned',
           'You have completed ' || p.title || '. Your certificate is ready.',
           'certificate:' || v_id::text
      from public.products p where p.id = p_product_id;
  end if;

  return v_id;
end;
$$;

revoke execute on function public.issue_certificate_if_earned(uuid, uuid) from public, anon, authenticated;
grant execute on function public.issue_certificate_if_earned(uuid, uuid) to service_role;


/* Completion now issues the certificate as well as evaluating activation.
   Everything else about this function is unchanged from migration 119. */
create or replace function public.settle_lesson_completion(p_user_id uuid, p_lesson_id uuid)
returns bool
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lesson     public.lessons;
  v_progress   public.lesson_progress;
  v_pass       int;
  v_quiz_req   bool;
  v_quizzes    int;
  v_passed     int;
  v_done       bool := false;
  v_product_id uuid;
begin
  select * into v_lesson from public.lessons where id = p_lesson_id;
  if not found then return false; end if;

  select s.product_id into v_product_id
    from public.course_sections s where s.id = v_lesson.section_id;

  select * into v_progress from public.lesson_progress
   where user_id = p_user_id and lesson_id = p_lesson_id;
  if not found then return false; end if;

  if v_progress.completed_at is not null then
    return true;
  end if;

  select coalesce(tp.lesson_pass_percent, 90), coalesce(tp.quiz_required, false)
    into v_pass, v_quiz_req
    from public.training_programs tp where tp.product_id = v_product_id;
  v_pass     := coalesce(v_pass, 90);
  v_quiz_req := coalesce(v_quiz_req, false);

  select count(*) into v_quizzes from public.quizzes where lesson_id = p_lesson_id;
  select count(distinct a.quiz_id) into v_passed
    from public.quiz_attempts a
    join public.quizzes q on q.id = a.quiz_id
   where q.lesson_id = p_lesson_id and a.user_id = p_user_id and a.passed;

  case v_lesson.kind
    when 'video' then
      v_done := v_progress.watched_percent >= v_pass
                and (not v_quiz_req or v_quizzes = 0 or v_passed >= v_quizzes);
    when 'quiz' then
      v_done := v_quizzes > 0 and v_passed >= v_quizzes;
    else
      v_done := v_progress.watched_percent >= 100
                and (v_quizzes = 0 or v_passed >= v_quizzes);
  end case;

  if not v_done then
    return false;
  end if;

  update public.lesson_progress set completed_at = now(), updated_at = now()
   where user_id = p_user_id and lesson_id = p_lesson_id;

  perform public.evaluate_affiliate_activation(p_user_id, v_product_id);
  perform public.issue_certificate_if_earned(p_user_id, v_product_id);
  return true;
end;
$$;

revoke execute on function public.settle_lesson_completion(uuid, uuid) from public, anon, authenticated;
grant execute on function public.settle_lesson_completion(uuid, uuid) to service_role;


-- ---------------------------------------------------------------------------
-- 2. Warning somebody their year is running out
-- ---------------------------------------------------------------------------
--
-- B11e: 30, 7 and 1 days before expiry.
--
-- NO NEW COLUMN TRACKS WHAT HAS BEEN SENT. The notification's own `reference`
-- is the record — 'affiliate_entitlement:<id>:30' — so a second run on the
-- same day cannot send a duplicate, and a job that fails halfway can simply be
-- run again. A `warned_30_at` column would be a second source of truth that
-- drifts the first time a send succeeds and the update does not.

create or replace function public.warn_expiring_entitlements()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_days  int;
  v_sent  int := 0;
  v_batch int;
begin
  foreach v_days in array array[30, 7, 1] loop
    insert into public.notifications (user_id, type, title, body, reference)
    select a.user_id,
           'announcement',
           case when v_days = 1 then 'Your affiliate access ends tomorrow'
                else 'Your affiliate access ends in ' || v_days || ' days' end,
           'Renew ' || p.title || ' to keep promoting and earning commission.',
           'affiliate_entitlement:' || e.id::text || ':' || v_days::text
      from public.affiliate_entitlements e
      join public.affiliate_accounts a on a.id = e.affiliate_id
      join public.training_programs tp on tp.id = e.training_program_id
      join public.products p on p.id = tp.product_id
     where e.status = 'active'
       and e.expires_at > now()
       and e.expires_at <= now() + make_interval(days => v_days)
       and not exists (
         select 1 from public.notifications n
          where n.reference = 'affiliate_entitlement:' || e.id::text || ':' || v_days::text
       );

    get diagnostics v_batch = row_count;
    v_sent := v_sent + v_batch;
  end loop;

  return v_sent;
end;
$$;

revoke execute on function public.warn_expiring_entitlements() from public, anon, authenticated;
grant execute on function public.warn_expiring_entitlements() to service_role;


-- ---------------------------------------------------------------------------
-- 3. Marking what has lapsed
-- ---------------------------------------------------------------------------
--
-- ⚠️ THIS CHANGES NOTHING ABOUT WHO CAN EARN, and that is the point worth
-- understanding before touching it.
--
-- `affiliate_depth_now` already computes lapsing LIVE from `grace_ends_at`, so
-- an affiliate stops earning the moment their grace runs out whether or not
-- this job has run. If the cron never fires, the money is still correct.
--
-- What this fixes is the `status` column TELLING THE TRUTH. Left alone it
-- says 'active' forever, so every admin screen reading it lies, and anybody
-- who later writes a query against `status` instead of the function gets the
-- wrong answer. Deriving the money and storing the label is the right way
-- round; storing both would be two sources of truth.

create or replace function public.expire_affiliate_entitlements()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare v_expired int;
begin
  update public.affiliate_entitlements
     set status = 'expired', updated_at = now()
   where status = 'active'
     and grace_ends_at <= now();

  get diagnostics v_expired = row_count;
  return v_expired;
end;
$$;

revoke execute on function public.expire_affiliate_entitlements() from public, anon, authenticated;
grant execute on function public.expire_affiliate_entitlements() to service_role;


-- ---------------------------------------------------------------------------
-- 4. One job, because there is one slot
-- ---------------------------------------------------------------------------
--
-- Returns what it did rather than nothing, so the route can log a line worth
-- reading and an operator can tell "ran and there was nothing to do" from
-- "did not run".
--
-- Each step is independent and none is allowed to take the others down with
-- it: a failure to send a warning must not stop commissions clearing, because
-- one is a nicety and the other is money somebody is waiting for.

create or replace function public.run_affiliate_maintenance()
returns table (expired int, cleared int, warned int, errors text[])
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_expired int := 0;
  v_cleared int := 0;
  v_warned  int := 0;
  v_errors  text[] := array[]::text[];
begin
  begin
    v_expired := public.expire_affiliate_entitlements();
  exception when others then
    v_errors := v_errors || ('expire: ' || sqlerrm);
  end;

  begin
    v_cleared := public.clear_due_commissions();
  exception when others then
    v_errors := v_errors || ('clear: ' || sqlerrm);
  end;

  begin
    v_warned := public.warn_expiring_entitlements();
  exception when others then
    v_errors := v_errors || ('warn: ' || sqlerrm);
  end;

  if array_length(v_errors, 1) > 0 then
    insert into public.system_alerts (severity, code, message, context)
    values ('high', 'affiliate_maintenance_failed',
            'Part of the nightly affiliate maintenance did not run.',
            jsonb_build_object('errors', v_errors));
  end if;

  return query select v_expired, v_cleared, v_warned, v_errors;
end;
$$;

revoke execute on function public.run_affiliate_maintenance() from public, anon, authenticated;
grant execute on function public.run_affiliate_maintenance() to service_role;
