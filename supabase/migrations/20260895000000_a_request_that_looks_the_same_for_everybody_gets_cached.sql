-- ============================================================================
-- Migration 195 — a request that looks the same for everybody gets cached
--
-- ⚠️ THIS IS WHY THE MAINTENANCE SCREEN SHUT OUT THE ALLOW-LISTED ACCOUNT.
--
-- `maintenance_closed_for_me()` took no arguments, on the reasoning that it
-- should only ever answer about the caller. Correct as a security property and
-- fatal as an HTTP one: every member's request to it was byte-identical apart
-- from the Authorization header, so the framework's fetch cache treated them
-- as the same request and served the FIRST answer to everyone. An ordinary
-- member hit it first, the answer was "closed", and staff and the test account
-- were then handed that same cached "closed" for as long as it lived.
--
-- It was invisible from the outside in the worst way: asked directly from a
-- SQL prompt the function returned exactly the right answer for every account,
-- which is how two rounds of debugging went past it.
--
-- Taking the subject as an ARGUMENT makes each member's request different, so
-- there is nothing for a shared cache to collapse. The guard that made the
-- no-argument version safe is kept explicitly: you may ask about yourself, and
-- staff may ask about anybody.
--
-- The same shape, for the same reason, as `game_status_for` and
-- `get_onboarding_state`. A user-facing read takes the user as an argument.
-- ============================================================================

create or replace function public.maintenance_closed_for(p_user_id uuid)
returns boolean
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_me      uuid := auth.uid();
  v_enabled boolean;
  v_allowed text;
  v_email   text;
  v_role    text;
begin
  if v_me is null or p_user_id is null then
    return false;
  end if;

  if p_user_id <> v_me and not public.is_admin() then
    raise exception 'Not allowed' using errcode = 'check_violation';
  end if;

  select (value = 'true') into v_enabled
    from public.app_config where key = 'maintenance_enabled';

  /* Fails OPEN. A missing row leaves the app usable: a hiccup locking every
     member out of a working product is worse than a window that starts late. */
  if not coalesce(v_enabled, false) then
    return false;
  end if;

  select role::text into v_role
    from public.user_roles where user_id = p_user_id
   order by case role::text
              when 'super_admin' then 1 when 'admin' then 2
              when 'support' then 3 when 'ads_manager' then 4 else 9 end
   limit 1;

  /* Staff always pass, or the switch could never be turned off again from the
     admin, which is reached through the same sign-in. */
  if v_role in ('super_admin', 'admin', 'support', 'ads_manager') then
    return false;
  end if;

  select coalesce(value, '') into v_allowed
    from public.app_config where key = 'maintenance_allow_emails';

  select lower(trim(email)) into v_email from auth.users where id = p_user_id;

  if v_email is not null and v_email <> '' then
    if exists (
      select 1
        from unnest(string_to_array(lower(coalesce(v_allowed, '')), ',')) as entry
       where trim(entry) = v_email
    ) then
      return false;
    end if;
  end if;

  return true;
end;
$$;

comment on function public.maintenance_closed_for(uuid) is
  'True when the member app should show the maintenance screen to this user. Staff always pass; so do addresses in maintenance_allow_emails. Takes the subject as an argument so per-user requests cannot be collapsed by a shared HTTP cache. Fails open.';

revoke execute on function public.maintenance_closed_for(uuid) from public, anon;
grant  execute on function public.maintenance_closed_for(uuid) to authenticated;

/* The no-argument version is dropped rather than left sitting there: it is
   correct SQL that is unsafe to call over HTTP, which is the worst kind of
   thing to leave lying around for somebody to reach for. */
drop function if exists public.maintenance_closed_for_me();
