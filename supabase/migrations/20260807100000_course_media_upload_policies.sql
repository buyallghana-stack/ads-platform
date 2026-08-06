-- ============================================================================
-- Migration 134 — the operator can put a video in `course-media`
--
-- `course-media` is private and, until now, carried NO storage policies at all.
-- That is a safe default and the right one for reads — learners never touch the
-- bucket directly, they receive a 15-minute signed URL issued server-side after
-- an entitlement check — but it also means nothing except the service key can
-- write to it, so the lesson editor had no way to upload a file.
--
-- ---------------------------------------------------------------------------
-- WHY THE BROWSER UPLOADS DIRECTLY
--
-- The alternative is posting the file to a server action and forwarding it with
-- the service key. That routes a 300 MB video through a serverless function to
-- put it somewhere the browser could have reached itself: slower, far more
-- expensive, and it turns a resumable storage upload into one long request that
-- fails whole.
--
-- So the browser uploads, and these policies are what let it.
--
-- ---------------------------------------------------------------------------
-- ⚠️ `is_super_admin`, NOT `is_admin`
--
-- The `ad-media` policies use `is_admin()`, and copying that shape here would
-- have been the obvious move. It would also have been a leak:
--
--     is_admin()        super_admin, admin, support, ads_manager
--     is_super_admin()  super_admin
--
-- `is_admin()` is true for a support agent. Giving support SELECT on this
-- bucket would let anyone who handles a password-reset ticket download every
-- paid course the platform sells — the exact outcome the private bucket exists
-- to prevent, arrived at from the inside instead of the outside.
--
-- Every catalogue RPC already calls `assert_admin`, which is super-admin only.
-- The storage the operator authors into has to match the RPCs that author it,
-- or the weaker of the two is the real permission.
--
-- ---------------------------------------------------------------------------
-- WHAT THIS DOES NOT DO
--
-- It does not give LEARNERS anything. There is deliberately no policy for a
-- buyer: entitlement is not expressible as a storage predicate without joining
-- three tables inside a policy that runs on every object access, and the signed
-- URL already answers it correctly in one place. A learner with a valid
-- entitlement still gets a signed URL and nothing else; a learner without one
-- still gets refused.
-- ============================================================================

create policy "Super admins read course media"
  on storage.objects for select
  using (bucket_id = 'course-media' and public.is_super_admin((select auth.uid())));

create policy "Super admins upload course media"
  on storage.objects for insert
  with check (bucket_id = 'course-media' and public.is_super_admin((select auth.uid())));

create policy "Super admins update course media"
  on storage.objects for update
  using (bucket_id = 'course-media' and public.is_super_admin((select auth.uid())))
  with check (bucket_id = 'course-media' and public.is_super_admin((select auth.uid())));

create policy "Super admins delete course media"
  on storage.objects for delete
  using (bucket_id = 'course-media' and public.is_super_admin((select auth.uid())));
