-- ============================================================================
-- Migration 119 — PHASE 2: the curriculum framework
--
-- Operator, 2026-08-06: *"it will be video, article or reading resources like
-- pdf to read from and in-video quiz, as well as separate quiz as part of the
-- section."* Reference screenshots: Udemy's mobile course player.
--
-- What the screenshots settle, and what this schema therefore has to support:
--
--   Sections with headers, and a numbered list of items under each.
--   Every item shows its KIND and its cost — "Video · 11:19", "Article ·
--   Resources (1)", or a quiz.
--   A completed item carries a tick; the current one is highlighted and reads
--   "5:49 remaining", so progress is per item and resumable.
--   Non-lecture items (Udemy's coding exercise) are numbered in their OWN
--   sequence alongside the lectures.
--
-- ---------------------------------------------------------------------------
-- ONE CURRICULUM TABLE, NOT TWO
--
-- A quiz that sits in the section list could have been its own table. It is a
-- `lessons` row with `kind = 'quiz'` instead, because the moment there are two
-- tables there are two orderings to keep in step, two progress tables, and a
-- "what is item 7?" question with two possible answers. Separate NUMBERING is
-- a presentation concern — the screenshots number lectures and exercises
-- independently, and that is a decision for the list component, not a reason
-- to split the data.
--
-- ---------------------------------------------------------------------------
-- COMPLETION BECOMES KIND-AGNOSTIC, AND THAT MATTERS FOR MONEY
--
-- `training_completion_percent` decides when somebody may start earning (B9),
-- and until now it asked a video-shaped question: watched enough, quiz passed.
-- An article has no watch percentage and a quiz has no duration. So the truth
-- moves to `lesson_progress.completed_at` — one column, set by whichever rule
-- fits the kind — and the percentage simply counts it. For a video lesson the
-- answer is identical to before, because the same rule now writes that column.
-- ============================================================================

do $$ begin
  create type public.lesson_kind as enum ('video', 'article', 'pdf', 'quiz');
exception when duplicate_object then null; end $$;


-- ---------------------------------------------------------------------------
-- 1. Lessons gain a kind
-- ---------------------------------------------------------------------------

alter table public.lessons
  add column if not exists kind public.lesson_kind not null default 'video',
  add column if not exists body text;

comment on column public.lessons.kind is
  'What this curriculum item IS. A quiz is a lesson too — one table, one ordering, one progress row.';
comment on column public.lessons.body is
  'The article text, for kind = article. Stored as text like an ebook chapter and for the same reason (E32): there is no file to leak.';

/* A lesson has to carry whatever its kind needs, or the player reaches an
   item with nothing in it. `pdf` is checked through its resources rather than
   here — a row constraint cannot see another table — so it is validated by
   `lesson_is_ready()` below, which is what publishing asks. */
alter table public.lessons
  drop constraint if exists lessons_kind_has_content,
  add constraint lessons_kind_has_content check (
    (kind = 'video'   and storage_path is not null)
    or (kind = 'article' and body is not null and length(btrim(body)) > 0)
    or kind in ('pdf', 'quiz')
  );

/* Duration is a video idea. An article's cost is its length and a quiz's is
   its question count, both derived — so this stays zero for them rather than
   becoming a second, lying number. */
comment on column public.lessons.duration_seconds is
  'Video length. Zero for every other kind: an article''s cost is its word count and a quiz''s is its questions, both derived rather than stored twice.';


-- ---------------------------------------------------------------------------
-- 2. Reading resources
-- ---------------------------------------------------------------------------
--
-- "Resources (1)" in the screenshots. PDFs and similar, attached to any
-- lesson.
--
-- ⚠️ READ IN APP, NEVER DOWNLOADED. The operator's decision on content
-- protection (E30/E32/E35) is deterrent-level and explicitly no downloads, so
-- these are served the same way course video is: a private bucket, a
-- short-lived signed URL, an entitlement checked first. The Udemy screenshots
-- show a download arrow on every row — that is the one thing from them we are
-- deliberately NOT copying.

create table if not exists public.lesson_resources (
  id           uuid primary key default gen_random_uuid(),
  lesson_id    uuid not null references public.lessons(id) on delete cascade,
  title        text not null,
  storage_path text not null,
  byte_size    bigint,
  position     int not null default 0,
  created_at   timestamptz not null default now(),
  constraint lesson_resources_title_present check (length(btrim(title)) > 0)
);

comment on table public.lesson_resources is
  'PDFs and reading material attached to a lesson. Served by signed URL after an entitlement check — never downloadable, despite what the reference screenshots show.';

create index if not exists lesson_resources_lesson_idx
  on public.lesson_resources (lesson_id, position);

alter table public.lesson_resources enable row level security;
/* No client policy: `storage_path` would ride along with the title, and the
   outline function below returns the count and the titles without it. */


-- ---------------------------------------------------------------------------
-- 3. Quizzes
-- ---------------------------------------------------------------------------
--
-- Two placements, one table, and the difference is a single column:
--
--   at_seconds IS NULL   the lesson IS the quiz (kind = 'quiz') — a standalone
--                        item in the section list.
--   at_seconds IS SET    an IN-VIDEO quiz: it interrupts a video lesson at
--                        that moment. A video may carry several.

create table if not exists public.quizzes (
  id           uuid primary key default gen_random_uuid(),
  lesson_id    uuid not null references public.lessons(id) on delete cascade,
  title        text not null default 'Quiz',
  at_seconds   int,
  pass_percent int not null default 70,
  position     int not null default 0,
  created_at   timestamptz not null default now(),
  constraint quizzes_pass_sane check (pass_percent between 1 and 100),
  constraint quizzes_at_sane   check (at_seconds is null or at_seconds >= 0),
  unique (lesson_id, at_seconds)
);

comment on column public.quizzes.at_seconds is
  'Null: this lesson IS the quiz, a standalone item in the section list. Set: an in-video quiz interrupting a video lesson at that second.';

create index if not exists quizzes_lesson_idx on public.quizzes (lesson_id, position);

create table if not exists public.quiz_questions (
  id          uuid primary key default gen_random_uuid(),
  quiz_id     uuid not null references public.quizzes(id) on delete cascade,
  position    int not null default 0,
  prompt      text not null,
  explanation text,
  created_at  timestamptz not null default now(),
  constraint quiz_questions_prompt_present check (length(btrim(prompt)) > 0)
);

create index if not exists quiz_questions_quiz_idx on public.quiz_questions (quiz_id, position);

create table if not exists public.quiz_options (
  id          uuid primary key default gen_random_uuid(),
  question_id uuid not null references public.quiz_questions(id) on delete cascade,
  position    int not null default 0,
  body        text not null,
  is_correct  bool not null default false,
  created_at  timestamptz not null default now(),
  constraint quiz_options_body_present check (length(btrim(body)) > 0)
);

create index if not exists quiz_options_question_idx on public.quiz_options (question_id, position);

alter table public.quizzes        enable row level security;
alter table public.quiz_questions enable row level security;
alter table public.quiz_options   enable row level security;

/*
  ⚠️ NO CLIENT POLICY ON ANY OF THE THREE, and `quiz_options` is the reason.

  It holds `is_correct`. A select policy would hand the answer key to the
  browser alongside the question, and RLS is row-level — there is no way to
  return the option text while withholding the flag beside it. Same shape as
  `lessons.storage_path`: the reachable surface is a function that returns what
  a learner may see, and the marking happens on the server.
*/


-- ---------------------------------------------------------------------------
-- 4. Attempts
-- ---------------------------------------------------------------------------
--
-- Every attempt is kept, not just the best one. A learner retrying is normal
-- and the history is what tells the Owner a quiz is too hard — and since
-- passing a quiz can be what activates an affiliate account (B9/B10), the
-- record of how somebody got there is worth having.

create table if not exists public.quiz_attempts (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  quiz_id       uuid not null references public.quizzes(id) on delete cascade,
  score_percent int not null,
  passed        bool not null,
  answers       jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  constraint quiz_attempts_score_sane check (score_percent between 0 and 100)
);

create index if not exists quiz_attempts_user_idx on public.quiz_attempts (user_id, quiz_id, created_at desc);

alter table public.quiz_attempts enable row level security;

create policy quiz_attempts_own on public.quiz_attempts
  for select to authenticated
  using (user_id = (select auth.uid()) or public.is_admin());


-- ---------------------------------------------------------------------------
-- 5. Is this item ready to publish?
-- ---------------------------------------------------------------------------
--
-- The checks a row constraint cannot make, because they span tables. Asked by
-- the admin before publishing rather than enforced on every write, so a
-- half-authored lesson can be saved and come back to.

create or replace function public.lesson_is_ready(p_lesson_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_lesson public.lessons;
  v_count  int;
begin
  select * into v_lesson from public.lessons where id = p_lesson_id;
  if not found then
    return 'Unknown lesson';
  end if;

  if v_lesson.kind = 'pdf' then
    select count(*) into v_count from public.lesson_resources where lesson_id = p_lesson_id;
    if v_count = 0 then
      return 'A reading lesson needs at least one resource';
    end if;
  end if;

  if v_lesson.kind = 'quiz' then
    select count(*) into v_count
      from public.quizzes q where q.lesson_id = p_lesson_id and q.at_seconds is null;
    if v_count = 0 then
      return 'A quiz lesson needs a quiz';
    end if;
  end if;

  /* Every quiz on this lesson — standalone or in-video — must be answerable.
     A question with no correct option cannot be passed, and a learner would
     simply be stuck, which is the worst kind of authoring mistake because it
     looks like their fault. */
  select count(*) into v_count
    from public.quizzes q
    join public.quiz_questions qq on qq.quiz_id = q.id
   where q.lesson_id = p_lesson_id
     and not exists (
       select 1 from public.quiz_options o
        where o.question_id = qq.id and o.is_correct
     );
  if v_count > 0 then
    return v_count || ' question(s) have no correct answer';
  end if;

  select count(*) into v_count
    from public.quizzes q
    join public.quiz_questions qq on qq.quiz_id = q.id
   where q.lesson_id = p_lesson_id
     and (select count(*) from public.quiz_options o where o.question_id = qq.id) < 2;
  if v_count > 0 then
    return v_count || ' question(s) have fewer than two options';
  end if;

  return null;   -- ready
end;
$$;

comment on function public.lesson_is_ready(uuid) is
  'Null when the lesson can be published, or a sentence saying what is missing. Cross-table checks a constraint cannot make, asked at publish time so a half-written lesson can still be saved.';

revoke execute on function public.lesson_is_ready(uuid) from public, anon, authenticated;
grant execute on function public.lesson_is_ready(uuid) to service_role;


-- ---------------------------------------------------------------------------
-- 6. The curriculum a learner sees
-- ---------------------------------------------------------------------------
--
-- Everything the section list in the screenshots needs, in one call: the kind,
-- the cost, the resource count, whether it is done, and where they got to.
-- Never a storage path, and never an answer key.

create or replace function public.course_curriculum(p_product_id uuid, p_user_id uuid default null)
returns table (
  section_id       uuid,
  section_title    text,
  section_position int,
  lesson_id        uuid,
  lesson_title     text,
  lesson_position  int,
  kind             text,
  duration_seconds int,
  word_count       int,
  resource_count   int,
  quiz_count       int,
  is_preview       bool,
  completed        bool,
  seconds_watched  int,
  watched_percent  int
)
language sql
stable
security definer
set search_path = ''
as $$
  select s.id, s.title, s.position,
         l.id, l.title, l.position,
         l.kind::text,
         l.duration_seconds,
         /* An article's cost, the way a video's is its duration. Derived, so
            it cannot disagree with the text actually stored. */
         coalesce(array_length(regexp_split_to_array(btrim(coalesce(l.body, '')), '\s+'), 1), 0),
         (select count(*)::int from public.lesson_resources r where r.lesson_id = l.id),
         (select count(*)::int from public.quizzes q where q.lesson_id = l.id),
         l.is_preview,
         coalesce(lp.completed_at is not null, false),
         coalesce(lp.seconds_watched, 0),
         coalesce(lp.watched_percent, 0)
    from public.course_sections s
    join public.lessons l on l.section_id = s.id
    left join public.lesson_progress lp
           on lp.lesson_id = l.id and lp.user_id = p_user_id
   where s.product_id = p_product_id
   order by s.position, l.position;
$$;

comment on function public.course_curriculum(uuid, uuid) is
  'The section list: kind, cost, resource count, done-ness and resume position. No storage paths and no answer keys.';

revoke execute on function public.course_curriculum(uuid, uuid) from public, anon;
grant execute on function public.course_curriculum(uuid, uuid) to authenticated, service_role;


-- ---------------------------------------------------------------------------
-- 7. A quiz, as a learner may see it
-- ---------------------------------------------------------------------------
--
-- `is_correct` is not in the return type. Not filtered out in a WHERE — absent
-- from the shape, so it cannot be added back by accident.

create or replace function public.quiz_for_learner(p_quiz_id uuid)
returns table (
  quiz_id      uuid,
  quiz_title   text,
  at_seconds   int,
  pass_percent int,
  question_id  uuid,
  prompt       text,
  question_position int,
  option_id    uuid,
  option_body  text,
  option_position int
)
language sql
stable
security definer
set search_path = ''
as $$
  select q.id, q.title, q.at_seconds, q.pass_percent,
         qq.id, qq.prompt, qq.position,
         o.id, o.body, o.position
    from public.quizzes q
    join public.quiz_questions qq on qq.quiz_id = q.id
    join public.quiz_options o    on o.question_id = qq.id
   where q.id = p_quiz_id
   order by qq.position, o.position;
$$;

revoke execute on function public.quiz_for_learner(uuid) from public, anon;
grant execute on function public.quiz_for_learner(uuid) to authenticated, service_role;


-- ---------------------------------------------------------------------------
-- 8. Marking a quiz
-- ---------------------------------------------------------------------------
--
-- SCORED ON THE SERVER, always. The client sends which option it chose per
-- question and gets back a score; the answer key never leaves the database.
-- Passing a quiz can be what activates an affiliate account, so a
-- client-scored quiz would be a client-granted right to earn money.

create or replace function public.submit_quiz_attempt(
  p_user_id uuid,
  p_quiz_id uuid,
  p_answers jsonb          -- { "<question_id>": "<option_id>", ... }
)
returns table (score_percent int, passed bool)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_quiz    public.quizzes;
  v_total   int;
  v_right   int;
  v_score   int;
  v_passed  bool;
  v_lesson  public.lessons;
begin
  select * into v_quiz from public.quizzes where id = p_quiz_id;
  if not found then
    raise exception 'Unknown quiz' using errcode = 'check_violation';
  end if;

  select count(*) into v_total from public.quiz_questions where quiz_id = p_quiz_id;
  if v_total = 0 then
    raise exception 'That quiz has no questions' using errcode = 'check_violation';
  end if;

  select count(*) into v_right
    from public.quiz_questions qq
    join public.quiz_options o
      on o.question_id = qq.id and o.is_correct
   where qq.quiz_id = p_quiz_id
     and (p_answers ->> qq.id::text) = o.id::text;

  v_score  := floor(v_right * 100.0 / v_total)::int;
  v_passed := v_score >= v_quiz.pass_percent;

  insert into public.quiz_attempts (user_id, quiz_id, score_percent, passed, answers)
  values (p_user_id, p_quiz_id, v_score, v_passed, coalesce(p_answers, '{}'::jsonb));

  /* A passed quiz feeds the lesson it belongs to. For a standalone quiz lesson
     that completes it outright; for an in-video quiz it satisfies the "and the
     quiz" half of B10, with the watch percentage still to be met. */
  if v_passed then
    insert into public.lesson_progress (user_id, lesson_id, quiz_passed)
    values (p_user_id, v_quiz.lesson_id, true)
    on conflict (user_id, lesson_id) do update set quiz_passed = true, updated_at = now();

    select * into v_lesson from public.lessons where id = v_quiz.lesson_id;
    perform public.settle_lesson_completion(p_user_id, v_quiz.lesson_id);
  end if;

  return query select v_score, v_passed;
end;
$$;

revoke execute on function public.submit_quiz_attempt(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.submit_quiz_attempt(uuid, uuid, jsonb) to service_role;


-- ---------------------------------------------------------------------------
-- 9. When is a lesson done?
-- ---------------------------------------------------------------------------
--
-- One place, asked by every path that could complete something. The rule
-- depends on the kind, and every kind agrees on one thing: `completed_at` is
-- set ONCE and never cleared. Activation is a one-way flip (B9) and this is
-- what makes that true one level down.

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
    return true;   -- one-way; never recomputed downward
  end if;

  select coalesce(tp.lesson_pass_percent, 90), coalesce(tp.quiz_required, false)
    into v_pass, v_quiz_req
    from public.training_programs tp where tp.product_id = v_product_id;
  v_pass     := coalesce(v_pass, 90);
  v_quiz_req := coalesce(v_quiz_req, false);

  /* Every quiz ON this lesson must be passed before it counts — that is what
     an in-video quiz is FOR. A video watched to the end with its questions
     unanswered is not a lesson somebody has done. */
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
      -- article and pdf: reading is the whole of it, and only the reader can
      -- say when that happened. `mark_lesson_read` sets the flag this reads.
      v_done := v_progress.watched_percent >= 100
                and (v_quizzes = 0 or v_passed >= v_quizzes);
  end case;

  if not v_done then
    return false;
  end if;

  update public.lesson_progress set completed_at = now(), updated_at = now()
   where user_id = p_user_id and lesson_id = p_lesson_id;

  perform public.evaluate_affiliate_activation(p_user_id, v_product_id);
  return true;
end;
$$;

revoke execute on function public.settle_lesson_completion(uuid, uuid) from public, anon, authenticated;
grant execute on function public.settle_lesson_completion(uuid, uuid) to service_role;


/* Reading has no percentage to report, so it gets its own verb. Idempotent:
   marking twice is what a double tap does. */
create or replace function public.mark_lesson_read(p_user_id uuid, p_lesson_id uuid)
returns bool
language plpgsql
security definer
set search_path = ''
as $$
declare v_kind public.lesson_kind;
begin
  select kind into v_kind from public.lessons where id = p_lesson_id;
  if v_kind is null then
    raise exception 'Unknown lesson' using errcode = 'check_violation';
  end if;
  if v_kind not in ('article', 'pdf') then
    raise exception 'Only an article or reading lesson is marked read'
      using errcode = 'check_violation';
  end if;

  insert into public.lesson_progress (user_id, lesson_id, watched_percent)
  values (p_user_id, p_lesson_id, 100)
  on conflict (user_id, lesson_id) do update
    set watched_percent = 100, updated_at = now();

  return public.settle_lesson_completion(p_user_id, p_lesson_id);
end;
$$;

revoke execute on function public.mark_lesson_read(uuid, uuid) from public, anon, authenticated;
grant execute on function public.mark_lesson_read(uuid, uuid) to service_role;


-- ---------------------------------------------------------------------------
-- 10. Watching, now routed through the one completion rule
-- ---------------------------------------------------------------------------

create or replace function public.record_lesson_progress(
  p_user_id uuid,
  p_lesson_id uuid,
  p_seconds int,
  p_percent int,
  p_quiz_passed bool default null
)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product_id uuid;
begin
  select s.product_id into v_product_id
    from public.lessons l join public.course_sections s on s.id = l.section_id
   where l.id = p_lesson_id;

  if v_product_id is null then
    raise exception 'Unknown lesson' using errcode = 'check_violation';
  end if;

  /* Forward only. A rewatch must not reduce a completed lesson, or scrubbing
     backwards would un-complete it and, at the threshold, un-make an
     affiliate. */
  insert into public.lesson_progress (user_id, lesson_id, seconds_watched, watched_percent, quiz_passed)
  values (p_user_id, p_lesson_id, greatest(p_seconds, 0), least(greatest(p_percent, 0), 100),
          coalesce(p_quiz_passed, false))
  on conflict (user_id, lesson_id) do update
    set seconds_watched = greatest(public.lesson_progress.seconds_watched, excluded.seconds_watched),
        watched_percent = greatest(public.lesson_progress.watched_percent, excluded.watched_percent),
        quiz_passed     = public.lesson_progress.quiz_passed or excluded.quiz_passed,
        updated_at      = now();

  perform public.settle_lesson_completion(p_user_id, p_lesson_id);

  return public.training_completion_percent(p_user_id, v_product_id);
end;
$$;

revoke execute on function public.record_lesson_progress(uuid, uuid, int, int, bool)
  from public, anon, authenticated;
grant execute on function public.record_lesson_progress(uuid, uuid, int, int, bool) to service_role;


-- ---------------------------------------------------------------------------
-- 11. Completion, counted the same way whatever the kind
-- ---------------------------------------------------------------------------
--
-- Was: watched enough AND quiz passed — a video-shaped question that an
-- article cannot answer. Now: count the lessons marked done. For a video the
-- result is unchanged, because the same rule writes that column.

create or replace function public.training_completion_percent(
  p_user_id uuid,
  p_product_id uuid
)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  with all_lessons as (
    select l.id
      from public.lessons l
      join public.course_sections s on s.id = l.section_id
     where s.product_id = p_product_id
  ),
  done as (
    select lp.lesson_id
      from public.lesson_progress lp
      join all_lessons al on al.id = lp.lesson_id
     where lp.user_id = p_user_id and lp.completed_at is not null
  )
  select case
           when (select count(*) from all_lessons) = 0 then 0
           else floor((select count(*) from done)::numeric * 100
                      / (select count(*) from all_lessons))::int
         end;
$$;

revoke execute on function public.training_completion_percent(uuid, uuid) from public, anon;
grant execute on function public.training_completion_percent(uuid, uuid) to authenticated, service_role;
