-- ============================================================================
-- Migration 057 — two corrections
--
--   1. Notifications leaked across accounts for admins.
--   2. Disputes are removed. The operator does not want them.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. Notifications are the reader's own, and nobody else's
-- ---------------------------------------------------------------------------
--
-- The policy was `auth.uid() = user_id OR is_admin()`, which is the pattern
-- used on thirteen tables in this schema so that admin screens can read what
-- they need. On every other table that is harmless, because every user-facing
-- query names its own user_id. On this one the read layer had no such filter
-- and trusted RLS to mean "my rows" — so an ADMIN opening their own dashboard
-- got every user's notifications merged into their bell and their list. The
-- operator found it on the two demo accounts.
--
-- The admin branch is dropped rather than kept, because nothing reads
-- notifications as an admin: the admin screens all go through SECURITY DEFINER
-- `admin_*` functions, and there is no screen that shows one user's
-- notifications to an operator. If one is ever built it should be such a
-- function, like every other admin read, not a widened policy on a table the
-- user's own dashboard queries.
--
-- The write paths were never affected — mark-read and clear are SECURITY
-- DEFINER and scope to `auth.uid()` in SQL — which is why the symptom was a
-- list showing somebody else's rows that could not be acted on.

drop policy if exists "Read own notifications or all as admin" on public.notifications;

create policy "Read own notifications" on public.notifications
  for select to authenticated
  using ((select auth.uid()) = user_id);

comment on table public.notifications is
  'A user''s own notifications. The select policy is deliberately NOT widened to admins — see migration 057; the user dashboard reads this table directly and an admin is a user there too.';


-- ---------------------------------------------------------------------------
-- 2. Disputes are gone
-- ---------------------------------------------------------------------------
--
-- OPERATOR DECISION (2026-07-29): "remove the dispute function; there is no
-- use of it because there are several ways i can internally hold transactions
-- even before sending" — a payout can be put on hold at any point before the
-- money leaves, the user is told it is on hold and why, and the chatbot
-- carries the conversation from there.
--
-- That is a better model than what dispute offered, and it removes the thing I
-- flagged when I built it: `disputed` was TERMINAL, with no resolution path,
-- so contesting a payment left the record permanently in a state nothing could
-- move it out of. Hold is reversible; dispute was not.
--
-- Nothing is refunded or clawed back by this migration. Dispute never moved
-- points by design, so removing it moves none either.

-- The one real disputed row goes back to what it actually is: a payout that
-- was made. `paid_at` and the transfer reference are untouched, so the
-- statement and the overview do not move by a pesewa.
--
-- Nothing is lost by dropping the columns: `admin_audit_log` holds the whole
-- row as jsonb at the moment it was disputed, reason included, and that record
-- outlives this migration.
-- The status trigger is muted for exactly this statement. `disputed → paid`
-- would otherwise fire `notify_redemption_status` and send the user a second
-- "Withdrawal sent" for money they were already told about — a notification
-- caused by a schema change, not by anything happening to their payout.
alter table public.redemptions disable trigger trg_notify_redemption_status;

update public.redemptions
   set status = 'paid'
 where status = 'disputed';

alter table public.redemptions enable trigger trg_notify_redemption_status;

drop function if exists public.dispute_redemption(uuid, uuid, text);

alter table public.redemptions
  drop constraint if exists redemptions_disputed_has_reason;

drop index if exists public.redemptions_disputed_idx;
drop index if exists public.redemptions_disputed_by_idx;

alter table public.redemptions
  drop column if exists disputed_at,
  drop column if exists disputed_by,
  drop column if exists dispute_reason;

delete from public.app_config where key = 'payout_dispute_window_hours';

-- THE ENUM LABEL SURVIVES, AND IS MADE UNREACHABLE INSTEAD.
--
-- Postgres cannot drop a value from an enum; removing it means building a new
-- type, re-typing `redemptions.status`, and dropping and recreating every
-- function that names `redemption_status` in its signature. That is real
-- surgery on the live money path to delete a label nobody can see. The check
-- constraint gets the whole benefit — no row can ever be disputed again — at
-- none of the risk. Say so here so the leftover label is not mistaken for an
-- oversight.
alter table public.redemptions
  drop constraint if exists redemptions_no_disputes;

alter table public.redemptions
  add constraint redemptions_no_disputes check (status <> 'disputed');


-- ---------------------------------------------------------------------------
-- 3. The dispatcher forgets the verb
-- ---------------------------------------------------------------------------
--
-- Taken VERBATIM from the live `pg_get_functiondef` with the four dispute
-- lines removed and nothing else touched — the same discipline migration 051
-- needed on `credit_points`, and for the same reason: this function has been
-- amended since it was first written, so the original migration's text is not
-- what runs. An old client that still sends 'dispute' now gets the explicit
-- "Unknown payout action" refusal rather than silently doing nothing.

create or replace function public.admin_decide_redemption(
  p_admin_id uuid,
  p_redemption_id uuid,
  p_action text,
  p_reason text default null,
  p_reference text default null,
  p_approve_early boolean default false,
  p_early_reason text default null
)
returns public.redemptions
language plpgsql
security definer
set search_path = ''
as $$
declare v_out public.redemptions;
begin
  perform public.assert_admin(p_admin_id);

  case p_action
    when 'approve' then
      v_out := public.approve_redemption(
        p_admin_id, p_redemption_id, nullif(trim(coalesce(p_reason, '')), ''),
        p_approve_early, p_early_reason);

    when 'hold' then
      v_out := public.hold_redemption(p_admin_id, p_redemption_id, p_reason);

    when 'decline' then
      v_out := public.reject_redemption(p_admin_id, p_redemption_id, p_reason);

    when 'mark_paid' then
      v_out := public.mark_redemption_paid(
        p_admin_id, p_redemption_id, nullif(trim(coalesce(p_reference, '')), ''));

    else
      raise exception 'Unknown payout action: %', p_action using errcode = 'check_violation';
  end case;

  return v_out;
end;
$$;

revoke execute on function public.admin_decide_redemption(uuid, uuid, text, text, text, boolean, text)
  from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 4. The queue stops reading a column that no longer exists
-- ---------------------------------------------------------------------------
--
-- Also verbatim from the live definition. Its ONLY dispute reference was the
-- decision-note fallback, `coalesce(r.dispute_reason, r.failure_reason,
-- r.review_notes)`, which loses its first term. The signature is unchanged, so
-- this is a replace rather than a drop — nothing that depends on the return
-- type has to be rebuilt.

create or replace function public.admin_list_redemptions(
  p_status public.redemption_status default null
)
returns table (
  id uuid, reference text, user_id uuid, user_name text, user_email text,
  user_avatar_path text, user_joined_at timestamptz, paid_before integer,
  paid_before_ghs numeric, points bigint, ghs numeric, method public.payout_method,
  provider text, destination text, account_name text, reuse integer,
  status public.redemption_status, requested_at timestamptz,
  status_changed_at timestamptz, holding_until timestamptz,
  admin_hold_at timestamptz, approved_early boolean, risk public.risk_level,
  risk_reasons text[], decision_note text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_decay int := public.config_int('fraud_signal_decay_days')::int;
begin
  if (select auth.uid()) is not null and not public.is_admin() then
    raise exception 'Not an administrator' using errcode = 'insufficient_privilege';
  end if;

  return query
  select
    r.id,
    'RDM-' || upper(substr(replace(r.id::text, '-', ''), 1, 6)),
    r.user_id,
    p.full_name,
    u.email::text,
    p.avatar_path,
    p.created_at,
    (select count(*)::int from public.redemptions q
      where q.user_id = r.user_id and q.status = 'paid' and q.id <> r.id),
    (select coalesce(sum(q.currency_amount), 0) from public.redemptions q
      where q.user_id = r.user_id and q.status = 'paid' and q.id <> r.id),
    r.points_amount,
    r.currency_amount,
    r.method,
    case r.method
      when 'crypto' then
        coalesce(r.snapshot_coin_code, '?')
        || coalesce(' · ' || r.snapshot_network_code, '')
      else
        coalesce(pp.name, r.snapshot_provider_code, '?')
    end,
    coalesce(r.snapshot_wallet, r.snapshot_msisdn, ''),
    coalesce(r.snapshot_account_name, ''),
    (select count(distinct q.user_id)::int
       from public.redemptions q
      where q.user_id <> r.user_id
        and (
          (r.snapshot_wallet is not null and q.snapshot_wallet = r.snapshot_wallet)
          or (r.snapshot_msisdn is not null and q.snapshot_msisdn = r.snapshot_msisdn)
        )),
    r.status,
    r.created_at,
    r.updated_at,
    r.holding_until,
    r.admin_hold_at,
    r.approved_early,
    r.risk_level_at_request,
    coalesce(
      (select array_agg(x.name order by x.weight desc)
         from (
           select distinct c.code, c.name, c.weight
             from public.fraud_signals s
             join public.fraud_checks c on c.code = s.check_code
            where s.user_id = r.user_id
              and s.created_at >= now() - make_interval(days => v_decay)
         ) x),
      '{}'::text[]
    ),
    coalesce(r.failure_reason, r.review_notes)
  from public.redemptions r
  join public.profiles p on p.id = r.user_id
  join auth.users u on u.id = r.user_id
  left join public.payout_providers pp on pp.code = r.snapshot_provider_code
  where p_status is null or r.status = p_status
  order by
    case when r.status in ('pending_approval', 'held') then 0 else 1 end,
    case when r.status in ('pending_approval', 'held') then r.created_at end asc,
    r.created_at desc;
end;
$$;

revoke execute on function public.admin_list_redemptions(public.redemption_status) from public, anon;
grant execute on function public.admin_list_redemptions(public.redemption_status)
  to authenticated, service_role;
