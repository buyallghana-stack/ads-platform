-- ============================================================================
-- Migration 030 — Personal info edits + profile avatar
--
-- Lets users maintain their own personal details (name, phone — freely, no
-- limit) and a profile picture, while CLOSING a latent hole: authenticated
-- had table-level UPDATE on profiles, so combined with the own-row RLS policy
-- a user could rewrite ANY of their columns — including flagged_at /
-- disabled_at (self-clearing a flag) and referral attribution.
--
--   * avatar_path: storage path of the user's picture (null = show initials).
--   * Column-level UPDATE grant: users may now write only full_name, phone and
--     avatar_path. Everything else (flags, disable, referral, timestamps) is
--     writable solely through SECURITY DEFINER functions running as owner.
--   * A public `avatars` storage bucket, with policies letting a user write
--     only inside their own {user_id}/… folder. Public read (it is a public
--     bucket) so the picture renders from a plain URL.
--
-- Applied to the live project via the Supabase MCP on 2026-07-24; this file is
-- the repo record of that change.
-- ============================================================================

alter table public.profiles add column avatar_path text;

comment on column public.profiles.avatar_path is
  'Storage path of the avatar within the public `avatars` bucket ({user_id}/file). Null = fall back to initials.';


-- Lock self-service profile writes to exactly the fields a user owns. The
-- own-row RLS policy still applies on top; this restricts WHICH columns.
revoke update on public.profiles from anon, authenticated;
grant  update (full_name, phone, avatar_path) on public.profiles to authenticated;


-- Avatars bucket: public read, small images only.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 5242880,
        array['image/jpeg','image/png','image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- A user may read and write only inside their own folder ({uid}/…). Anyone's
-- avatar renders through the bucket's public endpoint, which does not consult
-- these policies — but the authenticated storage API DOES: it resolves an
-- object through SELECT before deleting it, and with no SELECT policy
-- `remove()` matches zero rows and reports success while deleting nothing,
-- orphaning every replaced photo (still publicly reachable by URL). Hence the
-- own-folder SELECT policy below.
create policy "Avatar read own folder"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = ( select auth.uid()::text )
  );

create policy "Avatar upload to own folder"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = ( select auth.uid()::text )
  );

create policy "Avatar update in own folder"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = ( select auth.uid()::text )
  );

create policy "Avatar delete in own folder"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = ( select auth.uid()::text )
  );
