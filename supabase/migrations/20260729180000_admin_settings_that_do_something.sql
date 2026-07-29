-- ============================================================================
-- Migration 059 — the admin settings screen gets settings that exist
--
-- All five controls on /admin/settings were bound to keys that ARE NOT IN THE
-- DATABASE: require_admin_2fa, admin_session_hours, alert_on_payout_request,
-- alert_on_pool_ceiling, alert_on_critical_risk. `admin_set_config` refuses
-- unknown keys, so the form could not have saved even if it had been wired —
-- the same class of thing migration 052 found on the platform-settings screen.
--
-- THE RULE THIS MIGRATION FOLLOWS: a setting is only created here if something
-- READS it. A switch that saves and changes nothing is worse than no switch,
-- because it looks like a control and is really a note to nobody. So each key
-- below is listed with what acts on it, and `admin_session_hours` is NOT
-- created — see the note where its replacement is defined.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. Telling the operator something happened
-- ---------------------------------------------------------------------------
--
-- The three "alert me" toggles had no meaning to attach to, because there is
-- no channel to alert an operator on: email is unwired, and `system_alerts`
-- only surfaces later in the audit-log timeline, which nobody watches. So the
-- alerts become IN-APP NOTIFICATIONS to every administrator, using the
-- notification system that already exists and that admins, being users, can
-- already see.
--
-- One helper, so no caller has to know how admins are found.

create or replace function public.notify_admins(
  p_type  public.notification_type,
  p_title text,
  p_body  text,
  p_data  jsonb default '{}'::jsonb
)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare v_count int := 0;
begin
  -- Through `create_notification` rather than a raw insert, so admins get
  -- exactly the same row shape as users and nothing here has to remember
  -- which columns a notification has.
  perform public.create_notification(r.user_id, p_type, p_title, p_body, p_data)
    from public.user_roles r
    join public.profiles p on p.id = r.user_id
   where r.role = 'admin' and p.deleted_at is null;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

comment on function public.notify_admins(public.notification_type, text, text, jsonb) is
  'Sends one notification to every administrator. The delivery channel for the alert toggles on /admin/settings — email is unwired and system_alerts is not something anybody watches.';

revoke execute on function public.notify_admins(public.notification_type, text, text, jsonb)
  from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 2. The settings themselves
-- ---------------------------------------------------------------------------
--
-- What reads each one:
--
--   require_admin_2fa         src/app/[locale]/admin/layout.tsx — the single
--                             choke point every admin route passes through.
--                             An admin without an authenticator is sent to
--                             enrol rather than into the payout queue.
--   two_factor_recheck_hours  src/lib/security/login-2fa.ts — the lifetime of
--                             the signed `sp_2fa` marker, which was hardcoded
--                             to 12.
--   alert_on_payout_request   trg_notify_redemption_status, below.
--   alert_on_pool_ceiling     trg_alert_admins_on_system_alert, below.
--   alert_on_critical_risk    both of the above.
--
-- `admin_session_hours` FROM THE SCREEN IS DELIBERATELY NOT CREATED. There is
-- no admin session distinct from a user session — signing in is signing in,
-- and the only admin-specific timer in the system is how long a passed
-- two-factor check lasts. `two_factor_recheck_hours` is that timer under a
-- name that says what it does. It applies to everyone with 2FA enrolled, not
-- only admins, and the screen says so rather than implying an admin-only
-- scope it does not have.
--
-- (`session_idle_timeout_minutes` already existed and is read by nothing. It
-- is left alone here rather than quietly deleted — that is a decision for the
-- platform-settings screen that owns it.)

insert into public.app_config (key, value, value_type, min_value, max_value, is_public, description)
values
  ('require_admin_2fa', 'false', 'bool', null, null, false,
   'Require every administrator to have an authenticator app before they can open the admin area. An admin without one is sent to enrol, not locked out.'),

  ('two_factor_recheck_hours', '12', 'int', 1, 720, false,
   'How long a passed two-factor check lasts before it is asked for again. Applies to every account with 2FA enrolled, not only administrators.'),

  ('alert_on_payout_request', 'true', 'bool', null, null, false,
   'Notify every administrator in-app when a user files a withdrawal request.'),

  ('alert_on_pool_ceiling', 'true', 'bool', null, null, false,
   'Notify every administrator in-app when the daily reward pool crosses its ceiling.'),

  ('alert_on_critical_risk', 'true', 'bool', null, null, false,
   'Notify every administrator in-app when an account or a withdrawal is rated critical risk.')
on conflict (key) do nothing;


-- ---------------------------------------------------------------------------
-- 3. System alerts reach the people who need them
-- ---------------------------------------------------------------------------
--
-- A trigger on `system_alerts` rather than edits inside `credit_points` and
-- the fraud functions. Those are money-path functions that have each been
-- amended by several migrations, and threading a notification call through all
-- of them would mean restating each one from its live definition to add a line
-- that is not about what the function does. One trigger on the table they all
-- already write to gets the same result and generalises to alerts that do not
-- exist yet.
--
-- NOT every alert notifies. `redemption_approved_early` is raised BY the
-- operator's own click, and telling somebody what they just did is how a bell
-- icon becomes something people stop looking at.

create or replace function public.alert_admins_on_system_alert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if NEW.code = 'reward_pool_ceiling_exceeded' then
    if public.config_bool('alert_on_pool_ceiling') then
      perform public.notify_admins(
        'flag',
        'Reward pool ceiling reached',
        NEW.message,
        jsonb_build_object('alert_code', NEW.code, 'context', NEW.context));
    end if;

  elsif NEW.severity = 'critical' then
    if public.config_bool('alert_on_critical_risk') then
      perform public.notify_admins(
        'flag',
        'Critical alert',
        NEW.message,
        jsonb_build_object('alert_code', NEW.code, 'context', NEW.context));
    end if;
  end if;

  return NEW;
end;
$$;

drop trigger if exists trg_alert_admins_on_system_alert on public.system_alerts;
create trigger trg_alert_admins_on_system_alert
  after insert on public.system_alerts
  for each row execute function public.alert_admins_on_system_alert();


-- ---------------------------------------------------------------------------
-- 4. A withdrawal request tells the people who have to decide on it
-- ---------------------------------------------------------------------------
--
-- Taken VERBATIM from the live `pg_get_functiondef` with one block added to
-- the INSERT branch and nothing else touched. This function has been amended
-- since it was written, so the original migration's text is not what runs.

create or replace function public.notify_redemption_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_money text;
  v_dest  text;
begin
  v_money := trim(coalesce(NEW.currency_code, 'GHS')) || ' '
             || to_char(NEW.currency_amount, 'FM999999990.00');

  v_dest := case NEW.method
    when 'crypto' then
      coalesce(NEW.snapshot_coin_code, 'crypto')
      || coalesce(' (' || NEW.snapshot_network_code || ')', '')
    else
      coalesce(NEW.snapshot_provider_code, 'Mobile Money')
  end;

  if TG_OP = 'INSERT' then
    if NEW.status = 'held' then
      perform public.create_notification(
        NEW.user_id, 'payout',
        'Withdrawal request received',
        format('Your withdrawal of %s to %s has been received and is under review. We''ll let you know as soon as it''s approved.',
               v_money, v_dest),
        jsonb_build_object('redemption_id', NEW.id, 'status', NEW.status));
    end if;

    -- ---- and the operator hears about it ------------------------------
    -- Two separate switches because they answer different questions: "tell
    -- me money is being asked for" and "tell me this one looks wrong". An
    -- operator who has turned the routine one off still wants the second.
    if public.config_bool('alert_on_payout_request') then
      perform public.notify_admins(
        'payout',
        'Withdrawal requested',
        format('%s to %s is waiting for a decision.', v_money, v_dest),
        jsonb_build_object('redemption_id', NEW.id, 'user_id', NEW.user_id));
    end if;

    if NEW.risk_level_at_request in ('high', 'critical')
       and public.config_bool('alert_on_critical_risk') then
      perform public.notify_admins(
        'flag',
        'High-risk withdrawal',
        format('%s to %s was filed at %s risk.', v_money, v_dest, NEW.risk_level_at_request),
        jsonb_build_object('redemption_id', NEW.id, 'user_id', NEW.user_id,
                           'risk', NEW.risk_level_at_request));
    end if;

    return NEW;
  end if;

  if NEW.status is distinct from OLD.status then
    if NEW.status = 'approved' then
      perform public.create_notification(
        NEW.user_id, 'payout',
        'Withdrawal approved',
        format('Your withdrawal of %s to %s has been approved and is being processed.',
               v_money, v_dest),
        jsonb_build_object('redemption_id', NEW.id, 'status', NEW.status));
    elsif NEW.status = 'paid' then
      perform public.create_notification(
        NEW.user_id, 'payout',
        'Withdrawal sent',
        format('Your withdrawal of %s to %s has been sent.%s',
               v_money, v_dest,
               coalesce(' Reference: ' || NEW.external_reference || '.', '')),
        jsonb_build_object('redemption_id', NEW.id, 'status', NEW.status,
                           'reference', NEW.external_reference));
    elsif NEW.status = 'rejected' then
      perform public.create_notification(
        NEW.user_id, 'payout',
        'Withdrawal not approved',
        format('Your withdrawal of %s could not be approved, so your points have been returned to your balance.%s',
               v_money,
               coalesce(' Reason: ' || NEW.review_notes || '.', '')),
        jsonb_build_object('redemption_id', NEW.id, 'status', NEW.status));
    elsif NEW.status = 'failed' then
      perform public.create_notification(
        NEW.user_id, 'payout',
        'Withdrawal failed',
        format('Your withdrawal of %s to %s could not be completed, so your points have been returned to your balance.%s',
               v_money, v_dest,
               coalesce(' ' || NEW.failure_reason, '')),
        jsonb_build_object('redemption_id', NEW.id, 'status', NEW.status));
    end if;
  end if;

  return NEW;
end;
$$;


-- ---------------------------------------------------------------------------
-- 5. Who holds the keys
-- ---------------------------------------------------------------------------
--
-- The administrator list on the settings screen, with the one fact that makes
-- it worth showing: whether each of them has an authenticator. An admin
-- without one is the weakest point in the payout queue, and the screen exists
-- to make that visible before `require_admin_2fa` is ever switched on.
--
-- Granting and revoking the role is deliberately NOT here. A mis-grant hands
-- somebody the payout queue, and it is the one action on that screen that
-- cannot be undone from that screen. It stays a deliberate database action
-- until the operator asks for it.

drop function if exists public.admin_list_administrators();

create function public.admin_list_administrators()
returns table (
  id           uuid,
  name         text,
  email        text,
  two_factor   boolean,
  granted_at   timestamptz,
  last_seen_at timestamptz,
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
    -- Enrolled means CONFIRMED. A half-finished enrolment leaves a cipher
    -- behind with no confirmation, and counting that as protected is exactly
    -- the wrong way to be wrong on this screen.
    exists (select 1 from public.user_security s
             where s.user_id = p.id
               and s.totp_secret_cipher is not null
               and s.totp_confirmed_at is not null),
    r.granted_at,
    (select max(sr.signed_in_at) from public.user_session_records sr where sr.user_id = p.id),
    p.id = (select auth.uid())
  from public.user_roles r
  join public.profiles p on p.id = r.user_id
  join auth.users u on u.id = p.id
  where r.role = 'admin' and p.deleted_at is null
  order by r.granted_at;
end;
$$;

revoke execute on function public.admin_list_administrators() from public, anon;
grant execute on function public.admin_list_administrators() to authenticated, service_role;
