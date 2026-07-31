-- ============================================================================
-- Migration 088 — say what we can actually observe, which is "has been in"
--
-- Migration 087 changed `accepted` to "holds a password", on the reasoning
-- that a session record only proves a link once opened. MEASURED AFTERWARDS,
-- that is wrong too: redeeming an invitation writes a 60-character bcrypt hash
-- into `encrypted_password` before the recipient has chosen anything. Both
-- signals flip on the CLICK, so neither can tell somebody who set a password
-- from somebody who closed the tab on the way to it.
--
-- So this stops inferring. `accepted` now means exactly one observable thing —
-- THEY HAVE SIGNED IN AT LEAST ONCE — and the screen labels it that way. The
-- thing an operator actually needs when somebody is stuck is a lever, not a
-- diagnosis, and "send them a fresh sign-in link" is now offered for everybody
-- rather than only for accounts we had guessed were stranded.
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
    -- Has been in at least once. Nothing more is claimed.
    u.last_sign_in_at is not null,
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
