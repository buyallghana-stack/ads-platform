-- ============================================================================
-- Migration 087 — "accepted" means they can sign in, not that they clicked
--
-- `admin_list_administrators.accepted` was "has a session record". That is the
-- wrong question, and 2026-07-31 showed why: every invitation sent that day
-- pointed at a page that does not exist, so the recipient's link SIGNED THEM
-- IN (creating the session record) and then dropped them on a 404 without ever
-- reaching a password field. They showed as accepted, the offer to send them a
-- fresh link was withdrawn, and they had no way in.
--
-- The honest question is whether they hold a password, which is what lets
-- somebody sign in tomorrow without another emailed link. Only a boolean
-- leaves this function; the hash itself never does.
-- ============================================================================

create or replace function public.admin_list_administrators()
returns table (
  id           uuid,
  name         text,
  email        text,
  role         text,
  two_factor   boolean,
  granted_at   timestamptz,
  last_seen_at timestamptz,
  accepted     boolean,
  is_you       boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is not null and not public.is_admin() then
    raise exception 'Not an administrator' using errcode = 'insufficient_privilege';
  end if;

  return query
  select
    p.id,
    p.full_name,
    u.email::text,
    r.role::text,
    exists (select 1 from public.user_security s
             where s.user_id = p.id
               and s.totp_secret_cipher is not null
               and s.totp_confirmed_at is not null),
    r.granted_at,
    (select max(sr.signed_in_at) from public.user_session_records sr where sr.user_id = p.id),
    -- Can they get in on their own? Not "did a link once open for them".
    (u.encrypted_password is not null and u.encrypted_password <> ''),
    p.id = (select auth.uid())
  from public.user_roles r
  join public.profiles p on p.id = r.user_id
  join auth.users u on u.id = p.id
  where r.role in ('super_admin', 'admin', 'support', 'ads_manager')
    and p.deleted_at is null
  order by case r.role
             when 'super_admin' then 1 when 'admin' then 2
             when 'support' then 3 else 4 end,
           r.granted_at;
end;
$$;

revoke execute on function public.admin_list_administrators() from public, anon;
