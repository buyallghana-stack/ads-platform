-- ============================================================================
-- Migration 002 — Revoke public EXECUTE on internal functions
--
-- Postgres grants EXECUTE to PUBLIC by default, and Supabase publishes every
-- function in the `public` schema as a REST RPC endpoint. That combination
-- makes internal helpers callable by anonymous visitors at
-- /rest/v1/rpc/<name>, which the security advisor correctly flags.
--
-- handle_new_user() is the one that actually matters: it is SECURITY DEFINER
-- and inserts into user_roles. Direct invocation would fail for want of
-- trigger context, but "fails for an incidental reason" is not a security
-- boundary. Trigger functions are reached by the trigger, never by a caller.
--
-- Left deliberately callable:
--   is_admin(), current_app_role() — pure reads of the JWT claim, invoked by
--   RLS policies as the authenticated role. They expose nothing the caller's
--   own token does not already contain.
-- ============================================================================

revoke execute on function public.handle_new_user()        from public, anon, authenticated;
revoke execute on function public.touch_updated_at()       from public, anon, authenticated;
revoke execute on function public.generate_referral_code() from public, anon, authenticated;

-- Triggers execute with the privileges of the table owner, not the caller, so
-- revoking above does not affect signup. Verified by the signup smoke test.
