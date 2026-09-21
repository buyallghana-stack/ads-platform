-- ============================================================================
-- Migration 239 — a profile photo is the initials
--
-- Operator decision, 2026-09-21: users no longer upload a profile picture.
-- Everybody is drawn as the gradient circle with their initials, which is
-- what a new account has always looked like and what every screen already
-- falls back to.
--
-- WHY THIS IS A MIGRATION AND NOT JUST A DELETED COMPONENT
-- Removing the uploader removes the BUTTON. The `avatars` bucket would still
-- accept an insert from any signed-in browser token, because the policy that
-- allows it is written against the folder name and not against whether this
-- product has an upload screen. A feature switched off in the UI and left
-- open in the database is a feature that is still on; this repository has a
-- memo about exactly that shape.
--
-- So the write policies go and the read policy stays. The read one is doing
-- something else: the authenticated storage API resolves an object through
-- SELECT before deleting it, and with no SELECT policy a `remove()` reports
-- success while deleting nothing. Keeping it is what lets the operator clear
-- out what is already in the bucket.
--
-- THE COLUMN STAYS, AND IS NO LONGER READ
-- `profiles.avatar_path` keeps whatever it holds. Dropping it would be a
-- destructive migration in exchange for nothing — no code reads it after this
-- release — and it is the record of what is still sitting in the bucket. What
-- does change is the column-level grant: `authenticated` may no longer write
-- it, so the only path that ever set it is closed at the database too.
-- ============================================================================

drop policy if exists "Avatar upload to own folder" on storage.objects;
drop policy if exists "Avatar update in own folder" on storage.objects;
drop policy if exists "Avatar delete in own folder" on storage.objects;

-- Restated in full. `grant (a, b, c)` is not additive in the way the plain
-- form is, so naming the two columns that remain is what removes the third.
revoke update on public.profiles from anon, authenticated;
grant  update (full_name, phone) on public.profiles to authenticated;

comment on column public.profiles.avatar_path is
  'Historic. Profile photos were withdrawn on 2026-09-21 (migration 239): nothing reads this and nothing may write it. Kept as the record of what is still in the avatars bucket.';
