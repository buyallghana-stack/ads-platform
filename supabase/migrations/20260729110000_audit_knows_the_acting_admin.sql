-- ============================================================================
-- Migration 053 — the audit log learns who the acting admin was
--
-- FOUND BY THE CONFIG TESTS, 2026-07-29. A test asserted that changing two
-- settings wrote two audit rows attributed to the admin who changed them, and
-- got back none: every admin action ever recorded has `actor_id = null`.
--
-- WHY
-- `audit_row_change` takes the actor from `auth.uid()`. That works for a
-- change made with a user's own browser token, and every admin write in this
-- application is deliberately NOT one — the admin functions are revoked from
-- `authenticated` and run through the service client, where `auth.uid()` is
-- null by definition. So the trail has been recording WHAT changed and WHEN,
-- and silently dropping WHO on the floor, for every ad edit, every payout
-- decision and every config change.
--
-- That is the half of an audit trail that matters when something goes wrong.
-- "The points rate was changed to 2000 on Tuesday" is a fact; "and Ama did
-- it" is the reason anyone keeps the log.
--
-- THE FIX, AND WHY IT GOES IN assert_admin
-- Every admin function already begins with `assert_admin(p_admin_id)` — it is
-- the one line they all share, and it is the only place that has been told,
-- by the caller, who is acting. Setting a transaction-local variable there
-- attributes ALL of them at once: admin_save_ad, admin_delete_ad,
-- admin_set_ad_status, admin_decide_redemption, hold_redemption,
-- dispute_redemption and admin_set_config. Adding it to each function
-- separately would be seven chances to forget the eighth.
--
-- `set_config(..., is_local => true)` scopes it to the transaction, so it
-- cannot leak into the next request on a pooled connection. `auth.uid()`
-- still wins where it exists, so nothing about user-token writes changes.
--
-- assert_admin becomes VOLATILE. It was STABLE, which promises no side
-- effects, and this is one. It is only ever called via PERFORM at the top of
-- a function body, so nothing was relying on it being inlined or cached.
-- ============================================================================


create or replace function public.assert_admin(p_admin_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.user_roles r
     where r.user_id = p_admin_id and r.role = 'admin'
  ) then
    raise exception 'Not an administrator' using errcode = 'insufficient_privilege';
  end if;

  -- Transaction-local, so a pooled connection cannot carry it into somebody
  -- else's request. Read by audit_row_change when auth.uid() is null, which
  -- is every service-client write — i.e. every admin action there is.
  perform set_config('app.actor_id', p_admin_id::text, true);
end;
$$;

revoke execute on function public.assert_admin(uuid) from public, anon, authenticated;


create or replace function public.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  rec        jsonb;
  -- auth.uid() first: a change made with a real user token is attributed to
  -- that token, and app.actor_id can never override it. The fallback only
  -- answers when there is no session at all, which is exactly the
  -- service-client case it exists for.
  actor      uuid := coalesce(
                       auth.uid(),
                       nullif(current_setting('app.actor_id', true), '')::uuid
                     );
  actor_mail text;
begin
  rec := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;

  if actor is not null then
    select u.email into actor_mail from auth.users u where u.id = actor;
  end if;

  insert into public.admin_audit_log (
    actor_id, actor_email, action, entity_type, entity_id, old_values, new_values
  )
  values (
    actor,
    actor_mail,
    lower(tg_op),
    tg_table_name,
    rec ->> tg_argv[0],
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end
  );

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

comment on function public.audit_row_change() is
  'Row-level audit trail. Attributes the change to auth.uid() when there is a session, and otherwise to app.actor_id — the transaction-local id assert_admin sets, which is how service-client admin writes get a name against them.';
