-- ============================================================================
-- Migration 008 — Ad model
--
-- Ads, their attention questions, and per-user progress (§6.2). The earning
-- loop that consumes this — watch, answer, credit — is the next migration;
-- this one establishes the data and the eligibility rules.
--
-- The security property that matters most here: a correct answer must never
-- reach the browser. If it does, the attention question stops being a proof of
-- attention and becomes a formality that any script can pass, and the entire
-- reward economy is open. Three layers enforce that:
--
--   1. ad_questions and ad_question_options are readable by admins only. A
--      user's token cannot select them at all.
--   2. get_ad_question_for_user() returns a shape that structurally omits
--      is_correct and correct_answer, so the application cannot leak them by
--      forgetting to strip a field.
--   3. Answer checking happens server-side against the database (next
--      migration). The client submits a choice; it never receives the key.
--
-- No advertiser portal (§1): every row here is created by an admin.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

create type public.ad_format as enum ('video', 'survey');

create type public.ad_status as enum (
  'draft',      -- being written, never served
  'active',     -- serving
  'paused',     -- admin kill switch for one ad/campaign (§6.6)
  'exhausted',  -- max_completions reached; set automatically
  'archived'    -- retired, kept for history
);

-- Where a video comes from. YouTube completion tracking is weak, which the
-- brief accepts because the attention question is the real gate (§3).
create type public.video_source as enum ('upload', 'youtube');

create type public.answer_format as enum ('multiple_choice', 'short_text');

-- Per-user, per-ad terminal state.
create type public.user_ad_status as enum (
  'in_progress',   -- watched and/or attempted, not yet resolved
  'completed',     -- answered correctly, points credited
  'failed_locked'  -- retry cap spent; this ad is closed to this user (§6.2)
);


-- ---------------------------------------------------------------------------
-- ads
-- ---------------------------------------------------------------------------

create table public.ads (
  id uuid primary key default gen_random_uuid(),

  title       text not null check (length(trim(title)) between 2 and 200),
  description text,

  -- The operator sources advertisers offline, so this is a label for reporting
  -- rather than a foreign key to an account that does not exist.
  advertiser_name text,

  format public.ad_format not null,
  status public.ad_status not null default 'draft',

  -- §6.2: points per ad are set per ad by the admin. The tier's
  -- reward_multiplier is applied on top at credit time.
  points_reward bigint not null check (points_reward > 0),

  -- --- Video fields (null for surveys) ------------------------------------
  video_source     public.video_source,
  storage_path     text,  -- Supabase Storage object path, for uploads
  youtube_video_id text,  -- the 11-char id, not a full URL
  duration_seconds int check (duration_seconds is null or duration_seconds > 0),

  -- Minimum watch time before the question unlocks. Separate from duration so
  -- a 3-minute video can gate at 30 seconds if the operator wants.
  min_watch_seconds int check (min_watch_seconds is null or min_watch_seconds >= 0),

  -- --- Budget -------------------------------------------------------------
  -- Expressed in completions because that is what an advertiser buys. Points
  -- cost is bounded automatically: max_completions x points_reward. Null means
  -- unlimited, which should be rare and deliberate.
  max_completions   int check (max_completions is null or max_completions > 0),
  completions_count int not null default 0 check (completions_count >= 0),

  -- --- Scheduling ---------------------------------------------------------
  starts_at timestamptz,
  ends_at   timestamptz,

  -- Serving weight. Higher serves more often within the eligible pool.
  weight int not null default 100 check (weight > 0),

  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- A video ad needs a source and exactly one location; a survey needs none.
  constraint ads_video_shape check (
    case format
      when 'video' then
        video_source is not null
        and (
          (video_source = 'upload'  and storage_path is not null     and youtube_video_id is null)
          or
          (video_source = 'youtube' and youtube_video_id is not null and storage_path is null)
        )
      when 'survey' then
        video_source is null and storage_path is null and youtube_video_id is null
    end
  ),

  constraint ads_schedule_ordered check (ends_at is null or starts_at is null or ends_at > starts_at),
  constraint ads_watch_within_duration check (
    min_watch_seconds is null or duration_seconds is null or min_watch_seconds <= duration_seconds
  )
);

comment on table public.ads is
  'Admin-created ads. No advertiser portal (§1) — advertiser_name is a reporting label, not an account.';

-- The serving query filters on status and schedule. Partial index because only
-- active ads are ever selected for serving.
create index ads_serving_idx on public.ads (status, starts_at, ends_at)
  where status = 'active';

create index ads_created_at_idx on public.ads (created_at desc);
create index ads_created_by_idx on public.ads (created_by) where created_by is not null;


-- ---------------------------------------------------------------------------
-- ad_questions
-- ---------------------------------------------------------------------------
--
-- A video ad carries one attention question; a survey carries several and is
-- otherwise the same mechanism (§6.2). Modelling both as rows here means the
-- answer-checking path is identical for both formats.

create table public.ad_questions (
  id uuid primary key default gen_random_uuid(),
  ad_id uuid not null references public.ads (id) on delete cascade,

  position int not null default 0,

  question_text text not null check (length(trim(question_text)) between 3 and 500),
  answer_format public.answer_format not null,

  -- Short-text answers only. Compared case-insensitively and trimmed at check
  -- time; a question that asked for an exact string would fail honest users.
  -- Null for multiple choice, where correctness lives on the options.
  correct_answer text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint ad_questions_shortext_has_answer check (
    (answer_format = 'short_text'      and correct_answer is not null and length(trim(correct_answer)) > 0)
    or
    (answer_format = 'multiple_choice' and correct_answer is null)
  ),

  unique (ad_id, position)
);

comment on table public.ad_questions is
  'Attention questions. correct_answer is admin-only and must never be sent to a client — see get_ad_question_for_user().';

create index ad_questions_ad_idx on public.ad_questions (ad_id, position);


-- ---------------------------------------------------------------------------
-- ad_question_options
-- ---------------------------------------------------------------------------
--
-- Order is not stored as presentation order: §6.2 requires options to shuffle
-- on every attempt, so sort_order exists only to give admins a stable editing
-- view. Serving shuffles.

create table public.ad_question_options (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references public.ad_questions (id) on delete cascade,

  option_text text not null check (length(trim(option_text)) between 1 and 200),
  is_correct  boolean not null default false,
  sort_order  int not null default 0,

  created_at timestamptz not null default now()
);

comment on table public.ad_question_options is
  'Multiple-choice options. is_correct is admin-only. Options are shuffled at serve time (§6.2), so sort_order is for the admin editor only.';

create index ad_question_options_question_idx on public.ad_question_options (question_id);

-- Exactly one correct option per multiple-choice question. Without this, a
-- question with zero correct options is unanswerable and one with two is
-- exploitable.
create unique index ad_question_options_one_correct_idx
  on public.ad_question_options (question_id)
  where is_correct;


-- ---------------------------------------------------------------------------
-- user_ad_state — per-user terminal state for an ad
-- ---------------------------------------------------------------------------
--
-- Exists so serving eligibility is a single indexed lookup rather than an
-- aggregate over attempts. The serving query runs on every ad request, which
-- §8 names the hot path.

create table public.user_ad_state (
  user_id uuid not null references auth.users (id) on delete cascade,
  ad_id   uuid not null references public.ads (id) on delete cascade,

  status public.user_ad_status not null default 'in_progress',

  attempts_used int not null default 0 check (attempts_used >= 0),

  -- Set when the current attempt's watch requirement is satisfied. Cleared on
  -- a wrong answer, which is what enforces "must re-watch before retrying"
  -- (§6.2).
  watch_completed_at timestamptz,

  completed_at timestamptz,
  locked_at    timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  primary key (user_id, ad_id),

  constraint user_ad_state_completed_consistent check (
    (status = 'completed'     and completed_at is not null) or status <> 'completed'
  ),
  constraint user_ad_state_locked_consistent check (
    (status = 'failed_locked' and locked_at is not null) or status <> 'failed_locked'
  )
);

comment on table public.user_ad_state is
  'One row per user per ad. Drives serving eligibility: a completed or failed_locked ad is never served to that user again.';

-- The serving query asks "which ads has this user finished with?"
create index user_ad_state_user_status_idx on public.user_ad_state (user_id, status);
create index user_ad_state_ad_idx on public.user_ad_state (ad_id);


-- ---------------------------------------------------------------------------
-- ad_attempts — immutable attempt history
-- ---------------------------------------------------------------------------
--
-- §6.2: repeated failures feed the fraud risk score, so attempts are evidence
-- and are kept even after an ad is completed or locked. Append-only for the
-- same reason the ledger is: it is the record that a decision was justified.

create table public.ad_attempts (
  id bigint generated always as identity primary key,

  user_id uuid not null references auth.users (id) on delete cascade,
  ad_id   uuid not null references public.ads (id) on delete cascade,
  question_id uuid references public.ad_questions (id) on delete set null,

  attempt_number int not null check (attempt_number > 0),

  -- What the user actually submitted. Kept for fraud review; for multiple
  -- choice this is the option id, for short text the trimmed string.
  submitted_answer text,

  is_correct boolean not null,

  -- How long they actually watched before answering. A pattern of answering
  -- correctly at the minimum watch time on every ad is a bot signal.
  watch_seconds int check (watch_seconds is null or watch_seconds >= 0),

  created_at timestamptz not null default now()
);

comment on table public.ad_attempts is
  'Append-only attempt log. Feeds the fraud risk score (§7) and is evidence for why an ad was locked.';

create index ad_attempts_user_created_idx on public.ad_attempts (user_id, created_at desc);
create index ad_attempts_ad_idx on public.ad_attempts (ad_id, created_at desc);
create index ad_attempts_question_idx on public.ad_attempts (question_id) where question_id is not null;

create trigger ad_attempts_no_update
  before update on public.ad_attempts
  for each row execute function public.prevent_ledger_mutation();


-- ---------------------------------------------------------------------------
-- Housekeeping triggers
-- ---------------------------------------------------------------------------

create trigger ads_touch_updated_at
  before update on public.ads
  for each row execute function public.touch_updated_at();

create trigger ad_questions_touch_updated_at
  before update on public.ad_questions
  for each row execute function public.touch_updated_at();

create trigger user_ad_state_touch_updated_at
  before update on public.user_ad_state
  for each row execute function public.touch_updated_at();

-- Ad and question changes are admin config changes and belong in the same
-- trail (§2.5). Attempts and user state are user activity, not admin action,
-- so they are not audited here — the ledger and ad_attempts already record
-- those.
create trigger ads_audit
  after insert or update or delete on public.ads
  for each row execute function public.audit_row_change('id');

create trigger ad_questions_audit
  after insert or update or delete on public.ad_questions
  for each row execute function public.audit_row_change('id');


-- Auto-exhaust. Without this an ad keeps serving past the budget the
-- advertiser paid for, and the operator only finds out from the report.
create or replace function public.mark_ad_exhausted()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.max_completions is not null
     and new.completions_count >= new.max_completions
     and new.status = 'active'
  then
    new.status := 'exhausted';
  end if;
  return new;
end;
$$;

revoke execute on function public.mark_ad_exhausted() from public, anon, authenticated;

create trigger ads_auto_exhaust
  before update of completions_count on public.ads
  for each row execute function public.mark_ad_exhausted();


-- ---------------------------------------------------------------------------
-- Serving eligibility
-- ---------------------------------------------------------------------------
--
-- One ad is eligible for a user when it is active, inside its schedule, has
-- budget left, and the user has not already completed or locked it.
--
-- Weighted-random selection: an ad's chance is proportional to its weight, so
-- the operator can bias delivery without a separate scheduler. This implements
-- the budget-weighted strategy assumed at kickoff (§11 item 6) — say the word
-- and it becomes round-robin by changing this one function.

create or replace function public.get_eligible_ads(
  p_user_id uuid,
  p_limit   int default 10
)
returns setof public.ads
language sql
stable
set search_path = ''
as $$
  select a.*
  from public.ads a
  where a.status = 'active'
    and (a.starts_at is null or a.starts_at <= now())
    and (a.ends_at   is null or a.ends_at   >  now())
    and (a.max_completions is null or a.completions_count < a.max_completions)
    and not exists (
      select 1 from public.user_ad_state s
      where s.user_id = p_user_id
        and s.ad_id   = a.id
        and s.status in ('completed', 'failed_locked')
    )
  -- Weighted shuffle: -ln(u)/w is the standard trick for weighted sampling
  -- without replacement. Higher weight sorts earlier on average.
  order by -ln(random()) / a.weight
  limit greatest(p_limit, 1);
$$;

comment on function public.get_eligible_ads(uuid, int) is
  'Ads this user may watch now, weighted-random. Excludes paused, exhausted, out-of-schedule, and any ad the user has completed or failed.';


-- ---------------------------------------------------------------------------
-- get_ad_question_for_user — the answer never leaves the database
-- ---------------------------------------------------------------------------
--
-- Returns the question and, for multiple choice, its options in shuffled order
-- (§6.2) with correctness omitted from the return type entirely. Because the
-- shape has no is_correct column, no amount of careless application code can
-- pass the answer to a browser.
--
-- SECURITY DEFINER so it can read admin-only tables on behalf of a request
-- that legitimately needs the question but must not see the key.

create or replace function public.get_ad_question_for_user(
  p_ad_id    uuid,
  p_position int default 0
)
returns table (
  question_id   uuid,
  question_text text,
  answer_format public.answer_format,
  option_id     uuid,
  option_text   text
)
language sql
stable
security definer
set search_path = ''
as $$
  select q.id, q.question_text, q.answer_format, o.id, o.option_text
  from public.ad_questions q
  left join public.ad_question_options o on o.question_id = q.id
  where q.ad_id = p_ad_id
    and q.position = p_position
  order by random();
$$;

comment on function public.get_ad_question_for_user(uuid, int) is
  'Question plus shuffled options, with is_correct and correct_answer structurally absent from the return type. The only path by which a client may see a question.';

revoke execute on function public.get_ad_question_for_user(uuid, int) from public, anon;


-- ============================================================================
-- Row Level Security
-- ============================================================================

alter table public.ads                 enable row level security;
alter table public.ad_questions        enable row level security;
alter table public.ad_question_options enable row level security;
alter table public.user_ad_state       enable row level security;
alter table public.ad_attempts         enable row level security;


-- ads -----------------------------------------------------------------------
-- Users may see active ads: the player needs the title and video reference.
-- Nothing on this table reveals an answer.

create policy "Read active ads, or all as admin"
  on public.ads for select
  to authenticated
  using (status = 'active' or public.is_admin());

create policy "Admins insert ads"
  on public.ads for insert to authenticated with check (public.is_admin());

create policy "Admins update ads"
  on public.ads for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy "Admins delete ads"
  on public.ads for delete to authenticated using (public.is_admin());


-- ad_questions / ad_question_options ----------------------------------------
--
-- Admin-only, with no user-facing read policy of any kind. This is the layer
-- that stops a user simply selecting the correct answer out of the API. Users
-- reach questions exclusively through get_ad_question_for_user().

create policy "Admins read questions"
  on public.ad_questions for select to authenticated using (public.is_admin());
create policy "Admins insert questions"
  on public.ad_questions for insert to authenticated with check (public.is_admin());
create policy "Admins update questions"
  on public.ad_questions for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy "Admins delete questions"
  on public.ad_questions for delete to authenticated using (public.is_admin());

create policy "Admins read options"
  on public.ad_question_options for select to authenticated using (public.is_admin());
create policy "Admins insert options"
  on public.ad_question_options for insert to authenticated with check (public.is_admin());
create policy "Admins update options"
  on public.ad_question_options for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy "Admins delete options"
  on public.ad_question_options for delete to authenticated using (public.is_admin());


-- user_ad_state -------------------------------------------------------------
-- Readable by the owner so the UI can show progress. Not writable by anyone:
-- attempts_used is what enforces the retry cap, so a user who could edit it
-- would have unlimited retries.

create policy "Read own ad state or all as admin"
  on public.user_ad_state for select
  to authenticated
  using ((select auth.uid()) = user_id or public.is_admin());


-- ad_attempts ---------------------------------------------------------------
-- Readable by the owner and admins; written server-side only.

create policy "Read own attempts or all as admin"
  on public.ad_attempts for select
  to authenticated
  using ((select auth.uid()) = user_id or public.is_admin());
