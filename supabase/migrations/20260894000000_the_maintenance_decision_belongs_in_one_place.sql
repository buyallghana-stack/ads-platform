-- ============================================================================
-- Migration 194 — the maintenance decision belongs somewhere it can be tested
--
-- The first attempt spread the decision across the application: read two config
-- rows, read a role, compare an email. Every part of it worked when run against
-- production from a script, and in the deployed app it shut everybody out,
-- including staff and the allow-listed account. Two rounds of testing against a
-- runtime with no readable logs got no closer to which half was failing.
--
-- So it moves here, where it can be asked directly and answered the same way
-- every time. The application now makes one call and gets a boolean, and that
-- boolean can be checked from a SQL prompt in a second.
--
-- ⚠️ THE ORDER OF THESE CHECKS IS THE SAFETY PROPERTY.
--   off            nobody is shut out
--   staff          always pass, by role, so the switch can always be reached
--                  and turned off again from the admin
--   allow list     for the accounts that are not staff, such as a test account
--   everybody else closed
--
-- It is SECURITY DEFINER because `app_config`'s select policy is
-- `is_public OR is_admin()` and both keys are deliberately private: an allow
-- list of addresses is not something to hand to every browser that loads the
-- page. Granted to `authenticated` only, and it answers about the CALLER, so
-- one member cannot ask whether another is shut out.
-- ============================================================================

create or replace function public.maintenance_closed_for_me()
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
  if v_me is null then
    return false;
  end if;

  select (value = 'true') into v_enabled
    from public.app_config where key = 'maintenance_enabled';

  /* Fails OPEN. A missing row or a read that returns nothing leaves the app
     usable: a hiccup locking every member out of a working product is far
     worse than a maintenance window that starts a minute late. */
  if not coalesce(v_enabled, false) then
    return false;
  end if;

  select role::text into v_role
    from public.user_roles where user_id = v_me
   order by case role::text
              when 'super_admin' then 1 when 'admin' then 2
              when 'support' then 3 when 'ads_manager' then 4 else 9 end
   limit 1;

  if v_role in ('super_admin', 'admin', 'support', 'ads_manager') then
    return false;
  end if;

  select coalesce(value, '') into v_allowed
    from public.app_config where key = 'maintenance_allow_emails';

  select lower(trim(email)) into v_email from auth.users where id = v_me;

  if v_email is not null and v_email <> '' and v_allowed is not null then
    if exists (
      select 1
        from unnest(string_to_array(lower(v_allowed), ',')) as entry
       where trim(entry) = v_email
    ) then
      return false;
    end if;
  end if;

  return true;
end;
$$;

comment on function public.maintenance_closed_for_me() is
  'True when the member app should show the maintenance screen to the CALLER. Staff always pass; so do addresses in maintenance_allow_emails. Fails open.';

revoke execute on function public.maintenance_closed_for_me() from public, anon;
grant  execute on function public.maintenance_closed_for_me() to authenticated;
