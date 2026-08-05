-- ============================================================================
-- Migration 108 — PHASE 2, step 2 of 7: the content engine
--
-- Sections, lessons, ebook chapters, progress and certificates. ONE engine for
-- every kind of content (brief §3.3): a training program is a course, and the
-- only thing that differs is what buying it entitles you to. A separate
-- "training" system was explicitly rejected — two engines would drift, and the
-- drift would be in what counts as completed, which is what grants somebody
-- the right to earn money.
--
-- Nothing in Phase 1 is touched.
--
-- ---------------------------------------------------------------------------
-- THE TWO DECISIONS THIS MIGRATION EXISTS TO ENCODE
--
-- E35 — STREAMING WAS RESCINDED. Video is a plain file played by an ordinary
-- HTML5 player, with playback speed and Picture-in-Picture (both native, and
-- neither ever needed streaming). No transcode, no HLS, no provider.
--
--   ⚠️ But the file goes in a PRIVATE bucket, which is the one place this may
--   NOT copy Phase 1. `ad-media` is public — correct for advertising, where
--   the whole point is to be seen — and a public bucket URL is a permanent,
--   unauthenticated link. Paid course video behind a public URL is not
--   "downloadable if somebody tries"; it is published on the open internet.
--   The bucket below is private and reads go through a short-lived signed URL
--   minted only after an entitlement check.
--
-- E32 — EBOOKS ARE STORED AS TEXT, NOT AS A FILE. There is deliberately no
-- `storage_key` on an ebook anywhere in this schema: a column holding a path
-- to a whole PDF invites exactly the thing that decision rules out. The reader
-- receives chapters through an authenticated route and never holds the book.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Where course video lives
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit)
values ('course-media', 'course-media', false, 524288000)   -- private, 500 MB
on conflict (id) do update set public = false;

/* `do update set public = false` rather than `do nothing`: if this bucket ever
   exists already and is public, silently leaving it that way is the failure
   this migration is written to prevent. */

/* No storage RLS policy is created, so no client can read the bucket directly.
   Every byte is served through a signed URL issued server-side after the
   entitlement check. */


-- ---------------------------------------------------------------------------
-- 2. Course structure
-- ---------------------------------------------------------------------------

create table if not exists public.course_sections (
  id         uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  title      text not null,
  position   int not null default 0,
  created_at timestamptz not null default now(),
  constraint course_sections_title_present check (length(btrim(title)) > 0)
);

create index if not exists course_sections_product_idx
  on public.course_sections (product_id, position);

create table if not exists public.lessons (
  id               uuid primary key default gen_random_uuid(),
  section_id       uuid not null references public.course_sections(id) on delete cascade,
  title            text not null,
  position         int not null default 0,
  storage_path     text,
  duration_seconds int not null default 0,
  /* A lesson anybody may watch before buying. The store needs a way to show
     what the course is actually like, and this is cheaper than a separate
     trailer field that would then need its own player. */
  is_preview       bool not null default false,
  created_at       timestamptz not null default now(),
  constraint lessons_title_present check (length(btrim(title)) > 0),
  constraint lessons_duration_sane check (duration_seconds >= 0)
);

create index if not exists lessons_section_idx on public.lessons (section_id, position);

comment on column public.lessons.storage_path is
  'Object key in the PRIVATE course-media bucket. Never handed to a client; a short-lived signed URL is minted per request after an entitlement check.';

create table if not exists public.ebook_chapters (
  id         uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  title      text not null,
  position   int not null default 0,
  body       text not null,
  word_count int not null default 0,
  created_at timestamptz not null default now(),
  constraint ebook_chapters_title_present check (length(btrim(title)) > 0)
);

create index if not exists ebook_chapters_product_idx
  on public.ebook_chapters (product_id, position);

comment on table public.ebook_chapters is
  'An ebook stored as text, chapter by chapter (E32). There is deliberately no file and no storage key: the reader is served chunks through an authenticated route and never holds the whole book.';

alter table public.course_sections enable row level security;
alter table public.lessons         enable row level security;
alter table public.ebook_chapters  enable row level security;

/*
  NO CLIENT POLICIES ON ANY OF THE THREE, deliberately.

  A select policy on `lessons` would expose `storage_path` along with the
  title — RLS is row-level, not column-level. The path is useless without a
  signed URL, but handing out the internal shape of the bucket is a free gift
  to somebody probing.

  The curriculum a shopper is allowed to see is served by
  `course_outline()` below, which returns titles and durations and no paths.
  Everything else goes through the service client after an entitlement check.
*/


-- ---------------------------------------------------------------------------
-- 3. The curriculum a shopper may see
-- ---------------------------------------------------------------------------

create or replace function public.course_outline(p_product_id uuid)
returns table (
  section_id       uuid,
  section_title    text,
  section_position int,
  lesson_id        uuid,
  lesson_title     text,
  lesson_position  int,
  duration_seconds int,
  is_preview       bool
)
language sql
stable
security definer
set search_path = ''
as $$
  select s.id, s.title, s.position,
         l.id, l.title, l.position, l.duration_seconds, l.is_preview
    from public.course_sections s
    join public.products p on p.id = s.product_id and p.status = 'published'
    left join public.lessons l on l.section_id = s.id
   order by s.position, l.position
$$;

comment on function public.course_outline(uuid) is
  'What a course contains, for the product page. Titles and durations only — never storage paths — and only for a published product.';

revoke execute on function public.course_outline(uuid) from public, anon;
grant execute on function public.course_outline(uuid) to authenticated, service_role;


-- ---------------------------------------------------------------------------
-- 4. Progress
-- ---------------------------------------------------------------------------
--
-- B10: a lesson is complete when it has been watched to the required share AND
-- its quiz passed. Both live here as facts about the learner; the thresholds
-- that judge them live on the training program (step 4), because they are the
-- Owner's settings rather than properties of a lesson.
--
-- `completed_at` is set once and never cleared. B9's activation is a one-way
-- flip — publishing new lessons lowers everybody's completion percentage, and
-- an affiliate who has already qualified must not be deactivated by an edit to
-- the curriculum. Completion behaving the same way is what makes that true one
-- level down.

create table if not exists public.lesson_progress (
  user_id         uuid not null references auth.users(id) on delete cascade,
  lesson_id       uuid not null references public.lessons(id) on delete cascade,
  seconds_watched int not null default 0,
  watched_percent int not null default 0,
  quiz_passed     bool not null default false,
  completed_at    timestamptz,
  updated_at      timestamptz not null default now(),
  primary key (user_id, lesson_id),
  constraint lesson_progress_percent_sane check (watched_percent between 0 and 100),
  constraint lesson_progress_seconds_sane check (seconds_watched >= 0)
);

create index if not exists lesson_progress_user_idx on public.lesson_progress (user_id);

drop trigger if exists lesson_progress_touch_updated_at on public.lesson_progress;
create trigger lesson_progress_touch_updated_at
  before update on public.lesson_progress
  for each row execute function public.touch_updated_at();

create table if not exists public.reading_progress (
  user_id    uuid not null references auth.users(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  chapter_id uuid references public.ebook_chapters(id) on delete set null,
  position   int not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, product_id)
);

drop trigger if exists reading_progress_touch_updated_at on public.reading_progress;
create trigger reading_progress_touch_updated_at
  before update on public.reading_progress
  for each row execute function public.touch_updated_at();

alter table public.lesson_progress   enable row level security;
alter table public.reading_progress  enable row level security;

/* `own rows OR is_admin()` — the pattern 13 Phase 1 tables already use. The
   standing warning that comes with it: because an admin passes this policy for
   EVERY row, any user-facing query must still filter by user_id explicitly.
   The policy is not the filter. */
create policy lesson_progress_own on public.lesson_progress
  for select to authenticated
  using (user_id = (select auth.uid()) or public.is_admin());

create policy reading_progress_own on public.reading_progress
  for select to authenticated
  using (user_id = (select auth.uid()) or public.is_admin());

/* Writes go through the service client only. Progress decides who becomes an
   affiliate (B9), so a client that can write it directly can grant itself the
   right to earn money. */


-- ---------------------------------------------------------------------------
-- 5. Certificates (B12)
-- ---------------------------------------------------------------------------
--
-- Issued on completing a whole program, not on the activation threshold — a
-- certificate says "I finished this", and B9's percentage is about when
-- somebody may start promoting, which is a different claim.

create table if not exists public.certificates (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  product_id        uuid not null references public.products(id),
  issued_at         timestamptz not null default now(),
  verification_code text not null unique,
  unique (user_id, product_id)
);

comment on table public.certificates is
  'Proof somebody completed a course or training program. Survives entitlement expiry: it records something that remains true.';

create index if not exists certificates_user_idx on public.certificates (user_id);

alter table public.certificates enable row level security;

create policy certificates_own on public.certificates
  for select to authenticated
  using (user_id = (select auth.uid()) or public.is_admin());

/*
  The verification code is GENERATED, never sequential, and from
  `gen_random_bytes` rather than `random()` — Postgres's `random()` is a seeded
  deterministic PRNG, and a guessable code makes a certificate forgeable by
  counting. The same reasoning migration 065 applied to gift codes.

  12 characters over an unambiguous alphabet with no I, L, O, U, 1 or 0, so a
  code can be read off a screen and typed without argument.
*/
create or replace function public.generate_certificate_code()
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_alphabet constant text := '23456789ABCDEFGHJKMNPQRSTVWXYZ';
  v_code text := '';
  v_byte int;
begin
  for i in 1..12 loop
    v_byte := get_byte(extensions.gen_random_bytes(1), 0);
    v_code := v_code || substr(v_alphabet, (v_byte % length(v_alphabet)) + 1, 1);
  end loop;
  return v_code;
end;
$$;

revoke execute on function public.generate_certificate_code() from public, anon, authenticated;
grant execute on function public.generate_certificate_code() to service_role;
