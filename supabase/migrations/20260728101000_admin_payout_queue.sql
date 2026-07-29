-- ============================================================================
-- Migration 050 — the admin side of the payout queue
--
-- The redemption pipeline (migration 018) has been complete since the third
-- session: request, hold, approve, reject, mark paid, mark failed, all with
-- their refunds. What has never existed is a way to CALL any of it that is
-- not me typing SQL. This migration is the seam the admin screen talks to.
--
-- Two functions the pipeline was missing, and two the screen needs:
--
--   hold_redemption          an operator parking a request they have
--                            questions about. See migration 049 for why this
--                            is not the same event as the automatic hold
--                            every request starts in.
--   dispute_redemption       contesting a payment already made, inside a
--                            window the DATABASE enforces rather than
--                            trusting the button to have disappeared.
--   admin_decide_redemption  one entry point for all five verbs the UI
--                            offers, so there is one place that checks who is
--                            acting and one place a decision can be audited
--                            from.
--   admin_list_redemptions   the queue itself, with the review facts attached.
--
-- WHY A DISPATCHER RATHER THAN FIVE CALLS
-- The five underlying functions have five different signatures, three
-- different reason rules and one licence gate. Spreading that across five
-- branches of a server action means the rule about who may act lives in
-- TypeScript, five times. Here it is `assert_admin`, once, before anything
-- else can happen — and the app keeps the shape the UI already has, which is
-- a single decide(id, action, reason).
-- ============================================================================


-- A disputed row must say who contested it and why. Enforced here rather than
-- trusted to the only function that writes the status, because the point of a
-- dispute is the reason attached to it: one with no explanation is a payment
-- marked wrong with nothing for the next person to act on.
alter table public.redemptions
  drop constraint if exists redemptions_disputed_has_reason;

alter table public.redemptions
  add constraint redemptions_disputed_has_reason check (
    status <> 'disputed'
    or (disputed_at is not null and dispute_reason is not null
        and length(trim(dispute_reason)) >= 3)
  );


-- ---------------------------------------------------------------------------
-- hold_redemption
-- ---------------------------------------------------------------------------
--
-- Only from `pending_approval`. A request already sitting in `held` is either
-- inside its fraud window or already held by an operator, and holding it
-- again would write a new reason over the old one while changing nothing.
-- The UI reflects this — `availableActions` offers no hold on a held row —
-- but the UI is not the thing that protects the data.

create or replace function public.hold_redemption(
  p_admin_id      uuid,
  p_redemption_id uuid,
  p_reason        text
)
returns public.redemptions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_r     public.redemptions;
  v_out   public.redemptions;
  v_hours int;
  v_until timestamptz;
begin
  perform public.assert_admin(p_admin_id);

  if p_reason is null or length(trim(p_reason)) < 3 then
    raise exception 'A reason is required to hold a payout' using errcode = 'check_violation';
  end if;

  select * into v_r from public.redemptions where id = p_redemption_id for update;
  if not found then
    raise exception 'Redemption not found' using errcode = 'check_violation';
  end if;

  if v_r.status <> 'pending_approval' then
    raise exception 'Only a request awaiting approval can be held (status %)', v_r.status
      using errcode = 'check_violation';
  end if;

  -- 0 = indefinite. Parking the clock at infinity is what keeps
  -- release_matured_holds from sweeping the request straight back into the
  -- queue: its `holding_until <= now()` can never match. A positive value
  -- gives a real timestamp instead, and the existing sweep returns the
  -- request by itself when it elapses — no second code path.
  v_hours := public.config_int('admin_hold_auto_return_hours')::int;
  v_until := case
               when v_hours > 0 then now() + make_interval(hours => v_hours)
               else 'infinity'::timestamptz
             end;

  update public.redemptions
     set status        = 'held',
         admin_hold_at = now(),
         holding_until = v_until,
         reviewed_by   = p_admin_id,
         reviewed_at   = now(),
         review_notes  = trim(p_reason),
         updated_at    = now()
   where id = p_redemption_id
  returning * into v_out;

  return v_out;
end;
$$;

comment on function public.hold_redemption(uuid, uuid, text) is
  'Operator hold on a request awaiting approval. Distinct from the automatic fraud-catch hold; parks holding_until so the maturity sweep cannot undo it.';

revoke execute on function public.hold_redemption(uuid, uuid, text) from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- dispute_redemption
-- ---------------------------------------------------------------------------
--
-- MOVES NO POINTS. See migration 049 for the reasoning: the money has gone
-- and the points were debited at request, so there is nothing an automatic
-- correction could do here that would not be wrong half the time.
--
-- The window is checked here as well as in the UI. `canDispute` in
-- types.ts hides the button after 48 hours, which is the right behaviour and
-- no protection at all — a stale tab, a replayed request or a second operator
-- would all still reach this function.

create or replace function public.dispute_redemption(
  p_admin_id      uuid,
  p_redemption_id uuid,
  p_reason        text
)
returns public.redemptions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_r       public.redemptions;
  v_out     public.redemptions;
  v_window  int;
  v_elapsed numeric;
  v_from    timestamptz;
begin
  perform public.assert_admin(p_admin_id);

  if p_reason is null or length(trim(p_reason)) < 3 then
    raise exception 'A reason is required to dispute a payout' using errcode = 'check_violation';
  end if;

  select * into v_r from public.redemptions where id = p_redemption_id for update;
  if not found then
    raise exception 'Redemption not found' using errcode = 'check_violation';
  end if;

  if v_r.status <> 'paid' then
    raise exception 'Only a payout already marked paid can be disputed (status %)', v_r.status
      using errcode = 'check_violation';
  end if;

  -- paid_at is NOT NULL on a paid row (redemptions_paid_has_time), so the
  -- coalesce is belt and braces rather than a real branch.
  v_from    := coalesce(v_r.paid_at, v_r.updated_at);
  v_window  := public.config_int('payout_dispute_window_hours')::int;
  v_elapsed := extract(epoch from (now() - v_from)) / 3600.0;

  if v_elapsed >= v_window then
    raise exception 'The % hour window to dispute this payout closed % hour(s) ago',
      v_window, ceil(v_elapsed - v_window) using errcode = 'check_violation';
  end if;

  update public.redemptions
     set status         = 'disputed',
         disputed_at    = now(),
         disputed_by    = p_admin_id,
         dispute_reason = trim(p_reason),
         updated_at     = now()
   where id = p_redemption_id
  returning * into v_out;

  -- A contested payment is an operational event, not just a row change. It
  -- means money left and somebody now believes it should not have.
  insert into public.system_alerts (severity, code, message, context)
  values ('warning', 'redemption_disputed',
    format('Payout %s was disputed after being marked paid.', p_redemption_id),
    jsonb_build_object('redemption_id', p_redemption_id, 'admin_id', p_admin_id,
                       'paid_at', v_from, 'reason', trim(p_reason),
                       'currency_amount', v_r.currency_amount));

  return v_out;
end;
$$;

comment on function public.dispute_redemption(uuid, uuid, text) is
  'Contests a payout already marked paid, inside payout_dispute_window_hours. Records the contest; moves no points and reverses nothing on its own.';

revoke execute on function public.dispute_redemption(uuid, uuid, text) from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- admin_decide_redemption — the one entry point
-- ---------------------------------------------------------------------------
--
-- Actions match the UI's verbs exactly (see payout-actions.ts) so there is no
-- translation layer where the two can drift:
--
--   approve | hold | decline | mark_paid | dispute
--
-- Everything it dispatches to is already revoked from client roles, so this
-- adds no reach; what it adds is one assert_admin ahead of all of them and
-- one signature for the server action to call.

create or replace function public.admin_decide_redemption(
  p_admin_id      uuid,
  p_redemption_id uuid,
  p_action        text,
  p_reason        text default null,
  p_reference     text default null,
  p_approve_early boolean default false,
  p_early_reason  text default null
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

    when 'dispute' then
      v_out := public.dispute_redemption(p_admin_id, p_redemption_id, p_reason);

    else
      raise exception 'Unknown payout action: %', p_action using errcode = 'check_violation';
  end case;

  return v_out;
end;
$$;

comment on function public.admin_decide_redemption(uuid, uuid, text, text, text, boolean, text) is
  'Single entry point for every payout decision the admin screen offers. Verifies the acting admin once, then dispatches to the pipeline function that owns the transition.';

revoke execute on function public.admin_decide_redemption(uuid, uuid, text, text, text, boolean, text)
  from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- admin_list_redemptions — the queue, with the facts a decision needs
-- ---------------------------------------------------------------------------
--
-- The screen's job is "should this money leave?", so the row carries the
-- things that answer it rather than making the operator go and look:
--
--   reuse            how many OTHER accounts have cashed out to this exact
--                    destination. The single cheapest fraud signal a
--                    watch-to-earn platform has.
--   paid_before      what this account has already been paid, and how much.
--                    A first payout and a fifteenth are different decisions.
--   risk_reasons     the fraud checks that actually fired for this user,
--                    named, most damaging first.
--
-- DESTINATIONS COME BACK WHOLE. They are masked at render by
-- maskDestination(), never pre-masked here — a masked value cannot be
-- revealed when somebody legitimately needs to send the money, cannot be
-- compared for reuse, and cannot be tested. The mask belongs in the view.
-- Reaching this function at all already required being an admin.

drop function if exists public.admin_list_redemptions(public.redemption_status);

create function public.admin_list_redemptions(p_status public.redemption_status default null)
returns table (
  id                uuid,
  reference         text,
  user_id           uuid,
  user_name         text,
  user_email        text,
  user_avatar_path  text,
  user_joined_at    timestamptz,
  paid_before       int,
  paid_before_ghs   numeric,
  points            bigint,
  ghs               numeric,
  method            public.payout_method,
  provider          text,
  destination       text,
  account_name      text,
  reuse             int,
  status            public.redemption_status,
  requested_at      timestamptz,
  status_changed_at timestamptz,
  holding_until     timestamptz,
  admin_hold_at     timestamptz,
  approved_early    boolean,
  risk              public.risk_level,
  risk_reasons      text[],
  decision_note     text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_decay int := public.config_int('fraud_signal_decay_days')::int;
begin
  -- Same guard as admin_list_ads: an admin's own browser token answers to
  -- is_admin(), a null caller is the service client and already trusted.
  if (select auth.uid()) is not null and not public.is_admin() then
    raise exception 'Not an administrator' using errcode = 'insufficient_privilege';
  end if;

  return query
  select
    r.id,

    -- Stable, short, and quotable down a phone line. Derived rather than
    -- stored: a uuid is already unique, and a second identifier that can
    -- disagree with it is a second thing to keep right.
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

    -- Distinct OTHER users who have cashed out to this same destination.
    -- Counted on the destination the redemption was actually made to, not on
    -- the user's current saved details — those can be changed after the fact,
    -- which is exactly the pattern this is here to catch.
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

    -- The level FROZEN AT REQUEST, not the account's level today. The
    -- decision being reviewed is about this request, and a score that moved
    -- afterwards would quietly rewrite what the operator was looking at.
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

    -- Whichever note the last decision left. Ordered by how recent the
    -- decision that wrote it is, so a dispute is not hidden behind the
    -- approval note it followed.
    coalesce(r.dispute_reason, r.failure_reason, r.review_notes)

  from public.redemptions r
  join public.profiles p on p.id = r.user_id
  join auth.users u on u.id = r.user_id
  left join public.payout_providers pp on pp.code = r.snapshot_provider_code
  where p_status is null or r.status = p_status
  order by
    -- What needs a decision, oldest first, then everything else newest first.
    -- The queue is a worklist; the rest is history.
    case when r.status in ('pending_approval', 'held') then 0 else 1 end,
    case when r.status in ('pending_approval', 'held') then r.created_at end asc,
    r.created_at desc;
end;
$$;

comment on function public.admin_list_redemptions(public.redemption_status) is
  'The payout queue with the facts a decision needs: destination reuse across accounts, what this user has already been paid, and the fraud checks that fired. Destinations come back whole and are masked at render.';

revoke execute on function public.admin_list_redemptions(public.redemption_status) from public, anon;
grant execute on function public.admin_list_redemptions(public.redemption_status) to authenticated, service_role;
