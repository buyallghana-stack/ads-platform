-- ============================================================================
-- Migration 104 — fifteen server-only functions were callable with the public
--                 key, and every one of them trusts a user id it is handed
--
-- Found while fixing migration 103. That one closed two admin LIST functions;
-- this is the same defect in a much worse place, and it is not new code — it
-- has been reachable since each of these shipped.
--
-- THE SHAPE OF THE HOLE. Each function below takes the account it should act
-- on as a PARAMETER and never asks who is calling:
--
--   select proname, definition ilike '%auth.uid()%' … → false, all fifteen
--
-- That is a perfectly reasonable design for a function only the server can
-- call — the server action has already checked the session, and passing the id
-- down is how it says so. It is a catastrophe for a function ANYONE can call,
-- and `create function` grants EXECUTE to PUBLIC by default, so anyone could:
--
--   get_totp_secret_cipher(<any user id>)  read their two-factor secret
--   disable_totp(<any user id>)            turn their two-factor off
--   replace_backup_codes(<id>, <codes>)    hand themselves the recovery codes
--   request_account_deletion(<any id>)     queue somebody else's account
--   finalise_account_deletion(<any id>)    and carry it out
--
-- Reachability confirmed against the live project with the publishable key —
-- `get_totp_secret_cipher` on a random uuid answered HTTP 200 (null, because
-- no such account), which is the grant letting the call through. A real id was
-- one `admin_list_people` call away before migration 103 closed that.
--
-- WHY REVOKING IS SAFE, CHECKED RATHER THAN ASSUMED. Every call site of all
-- fifteen was read first: all of them go through `createAdminClient()`, the
-- service_role client, in a server action, an API route or a cron handler.
-- Not one is reached from a browser, so nothing loses a capability here.
--
-- `authenticated` is revoked too, not just `anon`. A signed-in user calling
-- `disable_totp(<somebody else's id>)` is exactly as bad as a stranger doing
-- it — the parameter is the whole problem, and being logged in does not make
-- it yours.
--
-- DELIBERATELY NOT TOUCHED:
--   is_admin()                              every RLS policy on 13 tables calls
--                                           it as the querying role; revoking it
--                                           would deny authenticated users their
--                                           own rows.
--   get_active_sessions/get_deletion_status/get_totp_status
--                                           self-scoped — they read auth.uid()
--                                           rather than taking an id, so they
--                                           can only ever answer about the
--                                           caller.
--   trigger functions                       invoked by the trigger mechanism,
--                                           which does not consult EXECUTE.
-- ============================================================================

revoke execute on function public.cancel_account_deletion(uuid) from public, anon, authenticated;
revoke execute on function public.clear_totp_failures(uuid) from public, anon, authenticated;
revoke execute on function public.confirm_totp_enrollment(uuid) from public, anon, authenticated;
revoke execute on function public.consume_backup_code(uuid, text) from public, anon, authenticated;
revoke execute on function public.disable_totp(uuid) from public, anon, authenticated;
revoke execute on function public.due_account_deletions() from public, anon, authenticated;
revoke execute on function public.finalise_account_deletion(uuid) from public, anon, authenticated;
revoke execute on function public.get_totp_secret_cipher(uuid) from public, anon, authenticated;
revoke execute on function public.is_identity_blocked(text, text) from public, anon, authenticated;
revoke execute on function public.record_session_context(uuid, uuid, text, text, text) from public, anon, authenticated;
revoke execute on function public.register_totp_failure(uuid) from public, anon, authenticated;
revoke execute on function public.replace_backup_codes(uuid, text[]) from public, anon, authenticated;
revoke execute on function public.request_account_deletion(uuid) from public, anon, authenticated;
revoke execute on function public.start_totp_enrollment(uuid, text) from public, anon, authenticated;
revoke execute on function public.totp_lock_state(uuid) from public, anon, authenticated;

grant execute on function public.cancel_account_deletion(uuid) to service_role;
grant execute on function public.clear_totp_failures(uuid) to service_role;
grant execute on function public.confirm_totp_enrollment(uuid) to service_role;
grant execute on function public.consume_backup_code(uuid, text) to service_role;
grant execute on function public.disable_totp(uuid) to service_role;
grant execute on function public.due_account_deletions() to service_role;
grant execute on function public.finalise_account_deletion(uuid) to service_role;
grant execute on function public.get_totp_secret_cipher(uuid) to service_role;
grant execute on function public.is_identity_blocked(text, text) to service_role;
grant execute on function public.record_session_context(uuid, uuid, text, text, text) to service_role;
grant execute on function public.register_totp_failure(uuid) to service_role;
grant execute on function public.replace_backup_codes(uuid, text[]) to service_role;
grant execute on function public.request_account_deletion(uuid) to service_role;
grant execute on function public.start_totp_enrollment(uuid, text) to service_role;
grant execute on function public.totp_lock_state(uuid) to service_role;
