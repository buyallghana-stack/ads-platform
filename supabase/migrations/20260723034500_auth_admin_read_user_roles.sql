-- ============================================================================
-- Migration 003 — Let the auth hook read user_roles
--
-- Bug found by end-to-end testing, not by SQL inspection.
--
-- custom_access_token_hook() executes as `supabase_auth_admin`. Migration 001
-- granted that role SELECT on public.user_roles, but the table also has RLS
-- enabled and carried no policy naming supabase_auth_admin. A table-level
-- GRANT is not sufficient once RLS is on: the policy is a second, independent
-- gate. The hook's SELECT therefore matched zero rows and coalesced to 'user',
-- silently making admin unreachable.
--
-- This failed closed — nobody was wrongly elevated — but it was undetectable
-- from inside psql, because running as the table owner bypasses RLS entirely.
-- Any future RLS work must be verified through the API with a real token.
--
-- Scope of this policy is deliberately narrow: SELECT only, for one internal
-- role, on one table. supabase_auth_admin cannot write role grants, so this
-- does not widen the privilege-escalation surface.
-- ============================================================================

create policy "Auth admin reads roles for token minting"
  on public.user_roles for select
  to supabase_auth_admin
  using (true);
