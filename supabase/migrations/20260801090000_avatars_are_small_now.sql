-- ============================================================================
-- Migration 094 — the avatars bucket stops accepting megabytes
--
-- Profile pictures are now shrunk in the browser before they are uploaded
-- (src/lib/profile/compress-image.ts): a centred 320px square, WebP, which
-- lands between 6 and 15 KB. The three that predate that were re-encoded by
-- scripts/compress-existing-avatars.mjs — 1.49 MB of pictures became 25 KB.
--
-- WHY THE CEILING MOVES TOO. The browser is not the last word on what reaches
-- storage: the upload goes straight from the page to the bucket under RLS, so
-- a client that skipped the compression step could still push whatever the
-- bucket allows. 5 MB was the old allowance and it is now two orders of
-- magnitude more than anything legitimate. 512 KB leaves generous room for
-- the fallback path — an old browser with no usable canvas uploads the
-- original, capped at 400 KB by the uploader — while making the 1.26 MB case
-- that started this unrepresentable.
--
-- This does NOT touch objects already in the bucket; a size limit is checked
-- on write. There is nothing left to catch, per the script's own read-back.
-- ============================================================================

update storage.buckets
   set file_size_limit = 524288
 where id = 'avatars';

comment on column public.profiles.avatar_path is
  'Storage path of the avatar within the public `avatars` bucket ({user_id}/file). Written as a compressed 320px square — see src/lib/profile/compress-image.ts. Null = fall back to initials.';
