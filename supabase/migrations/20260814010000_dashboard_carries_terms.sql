-- ---------------------------------------------------------------------------
-- The affiliate can see what they accepted, and when.
--
-- A record somebody cannot see is a record they cannot check. The dashboard
-- read already carries everything else about the affiliate account, so the
-- acceptance goes on the same object rather than earning a query of its own.
--
-- ── RENAMED AND WRAPPED, NOT REWRITTEN ──
--
-- `affiliate_dashboard` is forty lines of aggregation over training, money and
-- traffic. Copying that body to add two keys would leave two versions of it,
-- and the copy is the one that drifts. So the existing function keeps its body
-- under a new name and a thin wrapper adds the fields. A rename carries its
-- grants with it, so `_core` stays service-role only, and the wrapper is
-- revoked below because `create function` re-grants EXECUTE to PUBLIC.
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'affiliate_dashboard_core'
  ) then
    alter function public.affiliate_dashboard(uuid) rename to affiliate_dashboard_core;
  end if;
end $$;

create or replace function public.affiliate_dashboard(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_base jsonb;
  v_aff  record;
begin
  v_base := public.affiliate_dashboard_core(p_user_id);

  select a.terms_version, a.terms_accepted_at
    into v_aff
    from public.affiliate_accounts a
   where a.user_id = p_user_id;

  if not found then
    return v_base;
  end if;

  /* `terms_accepted_at` is NULL for anybody who joined before the mechanism
     existed, and the screen says "not recorded" rather than inventing a date
     they never agreed on. */
  return v_base
    || jsonb_build_object(
         'terms_version', v_aff.terms_version,
         'terms_accepted_at', v_aff.terms_accepted_at,
         'terms_current_version', coalesce(public.config_int('affiliate_terms_version'), 1)
       );
end;
$$;

revoke execute on function public.affiliate_dashboard(uuid) from public, anon, authenticated;
grant execute on function public.affiliate_dashboard(uuid) to service_role;
revoke execute on function public.affiliate_dashboard_core(uuid) from public, anon, authenticated;
grant execute on function public.affiliate_dashboard_core(uuid) to service_role;
