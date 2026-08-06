-- ============================================================================
-- Migration 144 — three things the references need and nothing stored
--
-- Approved from the reference screens: instructor profiles, save/bookmark, and
-- a grade on a certificate. Ratings and reviews were considered and declined,
-- so nothing here fabricates a star.
--
-- ---------------------------------------------------------------------------
-- 1. INSTRUCTORS
--
-- Every card in the references carries a face, a name and a line under it
-- ("Top Rated Instructor"). `vendors` had a name and contact details — enough
-- to email somebody, not enough to put on a card.
--
-- These live on `vendors` rather than in a new `instructors` table because a
-- vendor IS the author here: the Owner enlists one person or studio per
-- product (A2), there is no vendor login, and a second table would need its own
-- admin screen to say the same thing twice.
--
-- `headline` is free text rather than a computed badge. "Top Rated Instructor"
-- in the reference is a claim their platform can support because it has
-- ratings; ours cannot, so the operator writes what is true instead.
--
-- ---------------------------------------------------------------------------
-- 2. SAVED PRODUCTS
--
-- The bookmark on every card. Deliberately the thinnest possible table: who,
-- what, when. No folders, no notes, no ordering — those are features of a
-- library, and this is a shortlist.
--
-- ⚠️ RLS on this one, unlike most of Phase 2. Saves are per-user rows a user
-- both reads and writes constantly, so making them go through a server-only
-- RPC would add a round trip to every bookmark tap for no security gain. The
-- policy is genuinely "own rows" here — there is no admin clause, because
-- nobody needs to read somebody else's shortlist.
--
-- ---------------------------------------------------------------------------
-- 3. CERTIFICATE GRADE
--
-- "Grades 98%" on the certifications card.
--
-- Computed at ISSUE time and stored, not derived on read. A grade is a
-- statement about how somebody did on the day they finished; deriving it later
-- would let it move when a quiz is edited or a question is deleted, and a
-- certificate whose score changes after the fact is not a certificate.
--
-- Nullable, because certificates already exist that were issued before this
-- column did. A null grade renders as no grade rather than as zero.
-- ============================================================================

/* ---------------------------------------------------------------- */
/* 1. Instructors                                                    */
/* ---------------------------------------------------------------- */
alter table public.vendors
  add column if not exists display_name text,
  add column if not exists headline text,
  add column if not exists bio text,
  add column if not exists avatar_path text;

comment on column public.vendors.display_name is
  'What a buyer sees. `name` is the business name for the operator''s own records; this is the person on the card.';
comment on column public.vendors.headline is
  'One line under the name. Free text, not a computed badge — "Top Rated Instructor" is a claim a platform with ratings can make and we cannot.';
comment on column public.vendors.avatar_path is
  'Key in the public `product-covers` bucket. A face on a card is marketing, so it lives with the covers rather than behind signed URLs.';

/* ---------------------------------------------------------------- */
/* 2. Saved products                                                 */
/* ---------------------------------------------------------------- */
create table if not exists public.saved_products (
  user_id    uuid not null references auth.users (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, product_id)
);

/* Newest first, per user — the only way this is ever read. */
create index if not exists saved_products_user_recent
  on public.saved_products (user_id, created_at desc);

alter table public.saved_products enable row level security;

create policy "Read own saves" on public.saved_products
  for select using ((select auth.uid()) = user_id);

create policy "Add own saves" on public.saved_products
  for insert with check ((select auth.uid()) = user_id);

create policy "Remove own saves" on public.saved_products
  for delete using ((select auth.uid()) = user_id);

/* ---------------------------------------------------------------- */
/* 3. Certificate grade                                              */
/* ---------------------------------------------------------------- */
alter table public.certificates
  add column if not exists grade_percent int
    check (grade_percent is null or grade_percent between 0 and 100);

comment on column public.certificates.grade_percent is
  'Average quiz score at the moment the certificate was issued. Frozen deliberately: deriving it later would let it move when a quiz is edited, and a certificate whose score changes afterwards is not a certificate. Null on certificates issued before this column existed.';

/*
  Issue-time grading. `issue_certificate_if_earned` already decides WHETHER a
  certificate is due; this adds WHAT it says.

  The average is over the learner's best attempt per quiz in the course. Best
  rather than latest, because retrying is explicitly encouraged — a checkpoint
  is a proof of attention, not an exam (DESIGN.md call 4) — and grading someone
  on their last attempt would punish the retry the design invites.
*/
create or replace function public.certificate_grade_for(p_user_id uuid, p_product_id uuid)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select nullif(round(avg(best))::int, null)
    from (
      select max(qa.score_percent) as best
        from public.quiz_attempts qa
        join public.quizzes z on z.id = qa.quiz_id
        join public.lessons l on l.id = z.lesson_id
        join public.course_sections s on s.id = l.section_id
       where s.product_id = p_product_id
         and qa.user_id = p_user_id
       group by z.id
    ) per_quiz;
$$;

revoke execute on function public.certificate_grade_for(uuid, uuid) from public, anon, authenticated;
grant  execute on function public.certificate_grade_for(uuid, uuid) to service_role;
