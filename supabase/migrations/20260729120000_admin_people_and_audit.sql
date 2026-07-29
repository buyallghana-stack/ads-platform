-- ============================================================================
-- Migration 054 — the people screens and the audit log
--
-- Users, Flagged and Audit are the three screens that decide whether the
-- payout queue built in migration 050 can be trusted. Approving a payout
-- without being able to look at the account behind it is approving it blind,
-- and the audit log is the only thing that says who approved what.
--
-- Four things, and one of them is a fix:
--
--   assert_admin on flag/clear   flag_user_account and clear_user_flag have
--                                taken a p_admin_id since migration 029 and
--                                NEVER CHECKED IT. See below.
--   disable/enable               the columns have existed since migration 007
--                                and nothing has ever written them.
--   admin_list_people            one query behind Users and Flagged, with the
--                                activity that makes a flag reviewable.
--   admin_list_audit             admin_audit_log is rows of before/after
--                                jsonb; the screen needs events.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. The fix: flag and clear never verified the admin
-- ---------------------------------------------------------------------------
--
-- Both functions accept the acting admin's id and write it into
-- `flagged_by`, which reads as authentication and is not. Nothing checked
-- that the id belonged to an administrator, so the attribution was whatever
-- the caller claimed.
--
-- Not remotely exploitable today — the functions are revoked from every
-- client role, so only our own server code can reach them at all. It is
-- exploitable the moment somebody writes a second caller and passes the
-- wrong id, and it is inconsistent with every other admin function in the
-- schema.
--
-- The second reason matters as much: `assert_admin` is now what sets
-- `app.actor_id` for the audit trail (migration 053). Without it, flagging
-- and disabling an account — two of the most consequential things an operator
-- does to a person — would be the only admin actions still landing in the log
-- with no name against them.

create or replace function public.flag_user_account(p_admin_id uuid, p_user_id uuid, p_reason text)
returns public.profiles language plpgsql security definer set search_path = '' as $$
declare v_out public.profiles;
begin
  perform public.assert_admin(p_admin_id);

  if p_reason is null or length(trim(p_reason)) < 3 then
    raise exception 'A flag reason is required' using errcode = 'check_violation';
  end if;

  update public.profiles
     set flagged_at = now(), flagged_reason = trim(p_reason),
         flagged_by = p_admin_id, updated_at = now()
   where id = p_user_id
  returning * into v_out;

  if not found then
    raise exception 'Unknown user' using errcode = 'check_violation';
  end if;
  return v_out;
end;
$$;

create or replace function public.clear_user_flag(p_admin_id uuid, p_user_id uuid)
returns public.profiles language plpgsql security definer set search_path = '' as $$
declare v_out public.profiles;
begin
  perform public.assert_admin(p_admin_id);

  update public.profiles
     set flagged_at = null, flagged_reason = null, flagged_by = null, updated_at = now()
   where id = p_user_id
  returning * into v_out;

  if not found then
    raise exception 'Unknown user' using errcode = 'check_violation';
  end if;
  return v_out;
end;
$$;

revoke execute on function public.flag_user_account(uuid, uuid, text) from public, anon, authenticated;
revoke execute on function public.clear_user_flag(uuid, uuid)         from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 2. Disable and enable
-- ---------------------------------------------------------------------------
--
-- The harsh one. A flag is a note to the next operator and the account keeps
-- working; disabling stops the person earning and stops them withdrawing, so
-- it demands a reason for the same reason a decline does — the next operator
-- to open this account needs to know why, and so does support when the person
-- writes in.
--
-- Deliberately does NOT touch points or redemptions. A disabled account keeps
-- its balance, and a redemption already in flight still refunds to it if it
-- is declined (see reject_redemption): disabling must never confiscate what
-- somebody already earned, because the usual reason to disable is a suspicion
-- that may not survive review.

create or replace function public.disable_user_account(
  p_admin_id uuid,
  p_user_id  uuid,
  p_reason   text
)
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare v_out public.profiles;
begin
  perform public.assert_admin(p_admin_id);

  if p_reason is null or length(trim(p_reason)) < 3 then
    raise exception 'A reason is required to disable an account' using errcode = 'check_violation';
  end if;

  -- An admin cannot disable themselves. It is the one account whose loss
  -- cannot be undone from this screen, because the screen is behind it.
  if p_admin_id = p_user_id then
    raise exception 'You cannot disable your own account' using errcode = 'check_violation';
  end if;

  update public.profiles
     set disabled_at = now(), disabled_reason = trim(p_reason),
         disabled_by = p_admin_id, updated_at = now()
   where id = p_user_id
  returning * into v_out;

  if not found then
    raise exception 'Unknown user' using errcode = 'check_violation';
  end if;

  return v_out;
end;
$$;

create or replace function public.enable_user_account(p_admin_id uuid, p_user_id uuid)
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare v_out public.profiles;
begin
  perform public.assert_admin(p_admin_id);

  update public.profiles
     set disabled_at = null, disabled_reason = null, disabled_by = null, updated_at = now()
   where id = p_user_id
  returning * into v_out;

  if not found then
    raise exception 'Unknown user' using errcode = 'check_violation';
  end if;

  return v_out;
end;
$$;

revoke execute on function public.disable_user_account(uuid, uuid, text) from public, anon, authenticated;
revoke execute on function public.enable_user_account(uuid, uuid)        from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 3. admin_list_people
-- ---------------------------------------------------------------------------
--
-- One function behind Users and Flagged, because the operator asked for one
-- way to look at a person whatever brought you to them.
--
-- WHY THE ACTIVITY COLUMNS ARE HERE AND NOT LOOKED UP LATER
-- A balance alone cannot tell an operator whether somebody is a real user or
-- a farm. 90,000 points over five months and the same 90,000 in nine days are
-- the same number and completely different accounts, and the flag review is
-- exactly where that difference decides whether money leaves. So how much
-- they have earned in total, how many ads that took, how many people they
-- referred and when they were last here travel WITH the row.

drop function if exists public.admin_list_people(text);

create function public.admin_list_people(p_scope text default 'all')
returns table (
  id              uuid,
  name            text,
  email           text,
  phone           text,
  avatar_path     text,
  joined_at       timestamptz,
  balance_points  bigint,
  tier            text,
  status          text,
  flagged_by      text,
  flag_reason     text,
  lifetime_points bigint,
  ads_watched     int,
  referrals       int,
  last_active_at  timestamptz,
  paid_out_ghs    numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  -- Same guard as admin_list_ads and admin_list_redemptions: an admin's own
  -- browser token answers to is_admin(); a null caller is the service client.
  if (select auth.uid()) is not null and not public.is_admin() then
    raise exception 'Not an administrator' using errcode = 'insufficient_privilege';
  end if;

  return query
  select
    p.id,
    p.full_name,
    u.email::text,
    p.phone,
    p.avatar_path,
    p.created_at,
    coalesce(b.balance, 0),
    (public.resolve_user_tier(p.id)).name,

    case
      when p.disabled_at is not null then 'disabled'
      when p.flagged_at  is not null then 'flagged'
      else 'active'
    end,

    -- Who raised it. A flag with no `flagged_by` came from the fraud layer
    -- rather than a person, and those are read very differently: one is a
    -- colleague's judgement, the other is a rule that fired.
    case
      when p.flagged_at is null      then null
      when p.flagged_by is not null  then 'admin'
      else 'system'
    end,
    p.flagged_reason,

    coalesce(b.lifetime_earned, 0),

    -- Counted from the ledger rather than from ad_attempts: the ledger is
    -- what actually paid out, so this is "ads they were paid for", which is
    -- the number that matters next to a balance.
    (select count(*)::int from public.points_ledger l
      where l.user_id = p.id and l.entry_type in ('ad_view', 'survey')),

    (select count(*)::int from public.profiles r where r.referred_by = p.id),

    -- The most recent thing they actually did, whichever kind it was.
    greatest(
      p.created_at,
      coalesce((select max(l.created_at) from public.points_ledger l where l.user_id = p.id), p.created_at),
      coalesce((select max(s.signed_in_at) from public.user_session_records s where s.user_id = p.id), p.created_at)
    ),

    coalesce((select sum(q.currency_amount) from public.redemptions q
               where q.user_id = p.id and q.status = 'paid'), 0)

  from public.profiles p
  join auth.users u on u.id = p.id
  left join public.user_balances b on b.user_id = p.id
  where
    case p_scope
      when 'flagged' then (p.flagged_at is not null or p.disabled_at is not null)
      else true
    end
    -- A finalised deletion scrambles the auth row and renames the profile to
    -- 'Deleted user'. Those are not people an operator can act on.
    and p.deleted_at is null
  order by
    -- Anything needing attention first, then newest. An operator opening
    -- Users is usually looking for a problem, not browsing.
    case when p.disabled_at is not null then 0
         when p.flagged_at  is not null then 1
         else 2 end,
    p.created_at desc;
end;
$$;

comment on function public.admin_list_people(text) is
  'People for the Users and Flagged screens, with the activity a flag review needs: lifetime points, ads paid for, referrals, last seen and what has already been paid out.';

revoke execute on function public.admin_list_people(text) from public, anon;
grant execute on function public.admin_list_people(text) to authenticated, service_role;


-- ---------------------------------------------------------------------------
-- 4. admin_list_audit
-- ---------------------------------------------------------------------------
--
-- `admin_audit_log` stores rows: a table name, an id, and the whole before
-- and after as jsonb. That is the right thing to STORE — it survives schema
-- changes and never loses detail — and it is not what a person can read. The
-- screen needs events: who did what, to whom, and what changed.
--
-- So this interprets. The action vocabulary matches the UI's exactly
-- (`AuditEntry['action']` in types.ts), and anything that does not map to one
-- of those is left out rather than shown as a raw row — a log an operator
-- scrolls past is not a log they will check when it matters.
--
-- system_alerts is unioned in because the machine-raised events belong in the
-- same timeline. An operator asking "what happened on Tuesday?" should not
-- have to know which of two tables to look in.

drop function if exists public.admin_list_audit(int);

create function public.admin_list_audit(p_limit int default 200)
returns table (
  id       text,
  at       timestamptz,
  actor    text,
  action   text,
  target   text,
  before   text,
  after    text,
  note     text
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
  with events as (
    select
      'a' || l.id::text as id,
      l.created_at      as at,
      -- Before migration 053 every service-client write recorded a null
      -- actor. Those rows are real events with an unknown author, and saying
      -- so is better than implying the system did them.
      coalesce(l.actor_email, case when l.actor_id is null then 'Unknown' else 'Admin' end) as actor,
      case
        when l.entity_type = 'redemptions' and l.new_values ->> 'status' = 'approved'
             and l.old_values ->> 'status' is distinct from 'approved'  then 'payout_approved'
        when l.entity_type = 'redemptions' and l.new_values ->> 'status' = 'rejected'
             and l.old_values ->> 'status' is distinct from 'rejected'  then 'payout_declined'
        when l.entity_type = 'redemptions' and l.new_values ->> 'status' = 'paid'
             and l.old_values ->> 'status' is distinct from 'paid'      then 'payout_paid'
        when l.entity_type = 'profiles'
             and l.new_values ->> 'flagged_at' is not null
             and l.old_values ->> 'flagged_at' is null                  then 'account_flagged'
        when l.entity_type = 'profiles'
             and l.new_values ->> 'disabled_at' is not null
             and l.old_values ->> 'disabled_at' is null                 then 'account_disabled'
        when l.entity_type = 'app_config'                               then 'config_changed'
        when l.entity_type = 'ads' and l.action = 'insert'              then 'ad_created'
        when l.entity_type = 'ads' and l.new_values ->> 'status' = 'paused'
             and l.old_values ->> 'status' is distinct from 'paused'    then 'ad_paused'
        else null
      end as action,
      case
        when l.entity_type = 'redemptions' then
          'RDM-' || upper(substr(replace(l.entity_id, '-', ''), 1, 6))
          || coalesce(' · ' || (select pr.full_name from public.profiles pr
                                 where pr.id = (l.new_values ->> 'user_id')::uuid), '')
        when l.entity_type = 'profiles' then
          coalesce(l.new_values ->> 'full_name', l.entity_id)
        when l.entity_type = 'app_config' then l.entity_id
        when l.entity_type = 'ads' then coalesce(l.new_values ->> 'title', l.entity_id)
        else l.entity_id
      end as target,
      case when l.entity_type = 'app_config' then l.old_values ->> 'value' end as before,
      case when l.entity_type = 'app_config' then l.new_values ->> 'value' end as after,
      case
        when l.entity_type = 'redemptions' then
          coalesce(l.new_values ->> 'dispute_reason', l.new_values ->> 'review_notes')
        when l.entity_type = 'profiles' then
          coalesce(l.new_values ->> 'disabled_reason', l.new_values ->> 'flagged_reason')
        else null
      end as note
    from public.admin_audit_log l

    union all

    select
      's' || s.id::text,
      s.created_at,
      'System',
      'alert_raised',
      s.message,
      null, null,
      s.context ->> 'reason'
    from public.system_alerts s
  )
  select e.id, e.at, e.actor, e.action, e.target, e.before, e.after, e.note
    from events e
   where e.action is not null
   order by e.at desc
   limit greatest(coalesce(p_limit, 200), 1);
end;
$$;

comment on function public.admin_list_audit(int) is
  'The audit trail as events rather than row diffs, unioned with system_alerts so one timeline answers "what happened?". Rows that map to no known action are omitted deliberately.';

revoke execute on function public.admin_list_audit(int) from public, anon;
grant execute on function public.admin_list_audit(int) to authenticated, service_role;
