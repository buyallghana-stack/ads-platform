-- ============================================================================
-- Migration 106 — "view as user" refused every account, including ordinary ones
--
-- Migration 105 guards against a super admin viewing a fellow administrator:
--
--   if exists (select 1 from public.user_roles r where r.user_id = p_target)
--
-- `user_roles` holds a row for EVERY account, not only staff — 11 rows of
-- `user` alongside one `super_admin`, one `support` and one `ads_manager`. So
-- the guard matched everybody and the feature refused every target with "You
-- cannot view as another administrator". Caught by the verification script on
-- its first run against a real screen; no test would have found it, because
-- the fixture it would have used has the same `user` row as everyone else.
--
-- The corrected rule is "holds any role that is not the ordinary one".
-- Deliberately `<> 'user'` rather than a list of staff roles: an affiliate
-- manager role is already planned for Phase 2, and a list is a thing somebody
-- has to remember to extend. Written this way, a new staff role is covered on
-- the day it is created rather than the day somebody notices.
-- ============================================================================

create or replace function public.admin_start_view_session(
  p_admin_id uuid,
  p_target_user_id uuid
)
returns table (token text, expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token   text;
  v_minutes int;
  v_expires timestamptz;
  v_email   text;
  v_target  text;
begin
  perform public.assert_admin(p_admin_id);

  if p_target_user_id = p_admin_id then
    raise exception 'That is your own account' using errcode = 'check_violation';
  end if;

  if exists (
    select 1 from public.user_roles r
     where r.user_id = p_target_user_id and r.role::text <> 'user'
  ) then
    raise exception 'You cannot view as another administrator'
      using errcode = 'insufficient_privilege';
  end if;

  if not exists (
    select 1 from public.profiles p
     where p.id = p_target_user_id and p.deleted_at is null
  ) then
    raise exception 'Unknown user' using errcode = 'check_violation';
  end if;

  update public.admin_view_sessions
     set ended_at = now()
   where admin_id = p_admin_id and ended_at is null;

  v_minutes := coalesce(public.config_int('admin_view_session_minutes'), 30);
  v_expires := now() + make_interval(mins => v_minutes);
  v_token   := encode(extensions.gen_random_bytes(32), 'hex');

  insert into public.admin_view_sessions (token, admin_id, target_user_id, expires_at)
  values (v_token, p_admin_id, p_target_user_id, v_expires);

  select u.email::text into v_email from auth.users u where u.id = p_admin_id;
  select coalesce(p.full_name, u.email::text) into v_target
    from public.profiles p join auth.users u on u.id = p.id
   where p.id = p_target_user_id;

  insert into public.admin_audit_log
    (actor_id, actor_email, action, entity_type, entity_id, new_values)
  values (
    p_admin_id, v_email, 'view_as_user', 'profiles', p_target_user_id,
    jsonb_build_object('target', v_target, 'expires_at', v_expires, 'read_only', true)
  );

  return query select v_token, v_expires;
end;
$$;

revoke execute on function public.admin_start_view_session(uuid, uuid) from public, anon, authenticated;
grant execute on function public.admin_start_view_session(uuid, uuid) to service_role;


-- The same mistake, in the per-request lookup. Left uncorrected it would end
-- every session on its next page load rather than refusing it at the start,
-- which is the more confusing half of the same bug.
create or replace function public.admin_active_view_session(p_token text)
returns table (admin_id uuid, target_user_id uuid, expires_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select s.admin_id, s.target_user_id, s.expires_at
    from public.admin_view_sessions s
   where s.token = p_token
     and s.ended_at is null
     and s.expires_at > now()
     and public.admin_role(s.admin_id) = 'super_admin'
     and not exists (
       select 1 from public.user_roles r
        where r.user_id = s.target_user_id and r.role::text <> 'user'
     );
$$;

revoke execute on function public.admin_active_view_session(text) from public, anon, authenticated;
grant execute on function public.admin_active_view_session(text) to service_role;
