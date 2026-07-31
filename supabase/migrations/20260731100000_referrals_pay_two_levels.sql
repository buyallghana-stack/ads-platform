-- ============================================================================
-- Migration 083 — the referral programme pays TWO levels
--
-- Operator, 2026-07-31: the lawyer has approved a two-level programme, build
-- it. His opinion of 2026-07-30 (`legal/lawyer-opinion-2026-07-30.md`) named
-- two levels as the CEILING — "keeping the programme to two referral levels is
-- a sensible approach" — so two is the most this may ever become, and the
-- clearance rests on the programme staying attached to the sale of a real
-- service rather than to recruitment.
--
-- WHAT A SECOND LEVEL MEANS HERE
-- If G invites P and P invites R, then R is G's second level. G may now be
-- paid when R signs up, when R activates, and when R buys a plan — each from
-- its own configuration key, each defaulting to ZERO, exactly as all three
-- first-level stages still do today.
--
-- THE DEPTH LIMIT IS STRUCTURAL, NOT A SETTING. Every migration since 021 has
-- said "there is no ancestry column, so multi-level payouts are impossible by
-- construction". That property is not abandoned here, it is moved up one
-- notch: `second_level_referral` performs exactly ONE extra hop, written out
-- as two statements with no loop and no recursion. A third level is not
-- switched off — it is unexpressible, the same way the second one used to be.
-- Anyone adding a `while` or a recursive CTE to that function is changing the
-- legal character of the product, not refactoring it.
--
-- WHAT THE CEILING RULES OUT, AND THE TWO GUARDS THAT ENFORCE IT
--   * A referral must never cost more than the purchase that triggered it.
--     Level two is paid out of the REMAINDER of the sale after level one, so
--     the two commissions together can never exceed 100% of what was paid.
--   * A cycle must never pay. R -> P -> R is reachable (R refers P, then R
--     applies P's code before earning anything), and without a guard the
--     buyer would be their own second-level referrer. `second_level_referral`
--     refuses it.
--
-- CLAW-BACK IS THE HARD PART, and it is why this migration is long. Rejecting
-- a referral now has to unwind money paid to TWO different people, and a
-- second-level bonus can be reached from either end of the broken link. Both
-- ends are handled, and `l2_reversed_at` stops the same bonus being taken back
-- twice when both links are rejected.
--
-- NOTHING PAYS ANYTHING YET. All three new keys ship at 0, and all three
-- first-level keys are still at 0 in live config. This migration changes what
-- the platform CAN do, and changes nobody's balance.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. Configuration — one key per stage, mirroring the first-level keys
-- ---------------------------------------------------------------------------
--
-- Separate keys rather than a single "level two pays X% of level one" ratio:
-- the operator may reasonably want a second-level signup bonus of zero and a
-- second-level commission of two percent, and a ratio cannot express that.
-- `is_public` mirrors the level-one key of the same stage, so the second level
-- is exactly as visible to a signed-in user as the first.

insert into public.app_config
  (key, value, value_type, min_value, max_value, is_public, description)
values
  ('referral_signup_bonus_points_l2', '0', 'int', 0, null, true,
   'Second-level signup bonus: points paid to the person who invited YOUR referrer, when you invite someone new. Zero switches the second level of this stage off entirely — no ledger entry is created. Paid flat, like every referral reward.'),

  ('referral_activation_bonus_points_l2', '0', 'int', 0, null, true,
   'Second-level activation bonus: points paid to the person who invited your referrer, once your referee has watched the required number of ads. Zero switches it off. Paid flat.'),

  ('referral_purchase_commission_percent_l2', '0', 'decimal', 0, 50, false,
   'Second-level purchase commission: the percentage of a plan purchase credited to the referrer OF the buyer''s referrer. Paid out of what is left of the sale after the first-level commission, so the two together can never exceed the purchase. Zero switches the second level off.')
on conflict (key) do nothing;


-- ---------------------------------------------------------------------------
-- 2. Schema — where a second-level payment is recorded
-- ---------------------------------------------------------------------------
--
-- STAGES ONE AND TWO go on the `referrals` row itself, beside the columns that
-- already record the first-level amounts. The row (P -> R) is the event that
-- generates them, it generates at most one of each, and freezing the amount
-- there keeps the existing property that changing a configured bonus never
-- rewrites what somebody was already paid.
--
-- `l2_referrer_id` is FROZEN at signup. It is not re-derived at activation:
-- if the middle link is rejected between the two stages, the activation bonus
-- must still be attributable to whoever the signup bonus went to, or the
-- claw-back cannot find it.

alter table public.referrals
  add column if not exists l2_referrer_id uuid references auth.users (id) on delete set null,
  add column if not exists l2_signup_bonus_points bigint not null default 0
    check (l2_signup_bonus_points >= 0),
  add column if not exists l2_signup_bonus_paid_at timestamptz,
  add column if not exists l2_activation_bonus_points bigint not null default 0
    check (l2_activation_bonus_points >= 0),
  add column if not exists l2_activation_bonus_paid_at timestamptz,
  add column if not exists l2_reversed_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'referrals_l2_is_a_third_party'
  ) then
    alter table public.referrals
      add constraint referrals_l2_is_a_third_party
      check (l2_referrer_id is null
             or (l2_referrer_id <> referrer_id and l2_referrer_id <> referee_id));
  end if;
end $$;

create index if not exists referrals_l2_referrer_idx
  on public.referrals (l2_referrer_id, created_at desc)
  where l2_referrer_id is not null;

comment on column public.referrals.l2_referrer_id is
  'The second-level beneficiary of this referral: whoever invited the referrer. Frozen when the code is applied and never re-derived, so a bonus can always be traced back to the person who received it even after the middle link is rejected.';

comment on column public.referrals.l2_reversed_at is
  'Set when the second-level bonuses on this row have been clawed back. A broken link can be rejected from either end, and this is what stops the same bonus being taken back twice.';


-- STAGE THREE keeps its own table, because a referee may buy several plans.
-- One payment can now produce TWO commission rows, so the unique key moves
-- from the payment to (payment, level) — that constraint is one of the two
-- idempotency guards a retried Paystack webhook runs into, and dropping it
-- outright would leave only the ledger index.

alter table public.referral_commissions
  add column if not exists level smallint not null default 1,
  add column if not exists source_referral_id uuid references public.referrals (id) on delete cascade;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'referral_commissions_level_check') then
    alter table public.referral_commissions
      add constraint referral_commissions_level_check check (level in (1, 2));
  end if;
end $$;

-- Every existing row is a first-level commission whose source is its own
-- referral. (Live count is zero, but a migration that only works on an empty
-- table is a trap for the next environment.)
update public.referral_commissions
   set source_referral_id = referral_id
 where source_referral_id is null;

alter table public.referral_commissions
  alter column source_referral_id set not null;

alter table public.referral_commissions
  drop constraint if exists referral_commissions_payment_id_key;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'referral_commissions_payment_level_key') then
    alter table public.referral_commissions
      add constraint referral_commissions_payment_level_key unique (payment_id, level);
  end if;
end $$;

create index if not exists referral_commissions_source_idx
  on public.referral_commissions (source_referral_id);

comment on column public.referral_commissions.level is
  '1 = paid to the buyer''s own referrer. 2 = paid to that referrer''s referrer. There is no 3, and the CHECK is what says so.';

comment on column public.referral_commissions.source_referral_id is
  'The referral that produced the PURCHASE. Equals referral_id at level 1; at level 2 it is the link one step below the beneficiary''s own. Claw-back reaches second-level commissions through this column.';


-- ---------------------------------------------------------------------------
-- 3. second_level_referral — the one hop, and the only one
-- ---------------------------------------------------------------------------
--
-- Returns the referral row (G -> P) that entitles G to be paid for something
-- P's referee did, or null when there is nobody at the second level.
--
-- Read the two SELECTs: there is no loop, no recursion and no self-call. That
-- is deliberate and it is the whole depth limit. See the header.

create or replace function public.second_level_referral(p_referee_id uuid)
returns public.referrals
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_first  public.referrals;   -- P -> R, the link the referee is on
  v_second public.referrals;   -- G -> P, one step up
begin
  select * into v_first from public.referrals
   where referee_id = p_referee_id and status <> 'rejected';
  if not found then
    return null;
  end if;

  -- HOP. One statement, upward, once.
  select * into v_second from public.referrals
   where referee_id = v_first.referrer_id and status <> 'rejected';
  if not found then
    return null;
  end if;

  -- A cycle is reachable: R refers P, then R applies P's code before earning
  -- anything, and R becomes their own second-level referrer. Refuse rather
  -- than pay somebody for their own activity.
  if v_second.referrer_id = p_referee_id then
    return null;
  end if;

  -- Belt and braces. The table's own no-self CHECK makes this impossible.
  if v_second.referrer_id = v_first.referrer_id then
    return null;
  end if;

  return v_second;
end;
$$;

comment on function public.second_level_referral(uuid) is
  'The referral link one step above this user''s own, or null. Exactly one upward hop — no recursion, so a third level is unexpressible rather than merely disabled.';

revoke execute on function public.second_level_referral(uuid) from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 4. apply_referral_code — stage one, now paying two levels
-- ---------------------------------------------------------------------------
--
-- Restated from the LIVE definition (migration 081) with the second-level
-- block appended. Every guard above it is unchanged.

CREATE OR REPLACE FUNCTION public.apply_referral_code(p_referee_id uuid, p_code text, p_ip inet DEFAULT NULL::inet, p_fingerprint text DEFAULT NULL::text)
 RETURNS referrals
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_referrer public.profiles;
  v_referee  public.profiles;
  v_bonus    bigint;
  v_row      public.referrals;
  v_shared   int;
  v_l2ref    public.referrals;
  v_l2user   public.profiles;
  v_l2bonus  bigint;
begin
  select * into v_referee from public.profiles where id = p_referee_id;
  if not found then
    raise exception 'Unknown user' using errcode = 'check_violation';
  end if;

  if v_referee.referred_by is not null then
    raise exception 'A referral code has already been applied to this account'
      using errcode = 'check_violation';
  end if;

  if exists (select 1 from public.points_ledger l
              where l.user_id = p_referee_id and l.entry_type in ('ad_view','survey')) then
    raise exception 'Referral codes can only be applied before you start earning'
      using errcode = 'check_violation';
  end if;

  select * into v_referrer from public.profiles
   where referral_code = upper(trim(p_code));
  if not found then
    raise exception 'That referral code is not valid' using errcode = 'check_violation';
  end if;

  if v_referrer.id = p_referee_id then
    raise exception 'You cannot refer yourself' using errcode = 'check_violation';
  end if;

  if v_referrer.disabled_at is not null then
    raise exception 'That referral code is no longer active' using errcode = 'check_violation';
  end if;

  v_shared := 0;
  if p_fingerprint is not null then
    select count(*) into v_shared from public.user_devices d
     where d.fingerprint = p_fingerprint and d.user_id = v_referrer.id;
  end if;
  if v_shared = 0 and p_ip is not null then
    select count(*) into v_shared from public.auth_signals s
     where s.ip = p_ip and s.user_id = v_referrer.id;
  end if;

  /* FLAT (operator, 2026-07-30). No resolve_user_tier, no multiplier: an
     invited person is worth the same to everybody who invites them. */
  v_bonus := coalesce(public.config_int('referral_signup_bonus_points'), 0)::bigint;

  insert into public.referrals (referrer_id, referee_id, code_used, signup_bonus_points)
  values (v_referrer.id, p_referee_id, upper(trim(p_code)), v_bonus)
  returning * into v_row;

  update public.profiles set referred_by = v_referrer.id where id = p_referee_id;

  if v_bonus > 0 then
    perform public.credit_points(
      v_referrer.id, v_bonus, 'referral_signup', 'referral', v_row.id::text,
      jsonb_build_object('referee_id', p_referee_id, 'flat_rate', true, 'level', 1)
    );
    update public.referrals set signup_bonus_paid_at = now() where id = v_row.id
    returning * into v_row;
  end if;

  /* ------------------------------------------------------------------
     SECOND LEVEL (migration 083). The row above was inserted first, so
     the hop starts from a link that already exists.

     `l2_referrer_id` is recorded even when the bonus is zero or the
     beneficiary is disabled: it is what stage two and the claw-back
     read, and re-deriving it later would give a different answer once a
     link has been rejected. */
  v_l2ref := public.second_level_referral(p_referee_id);

  if v_l2ref.id is not null then
    select * into v_l2user from public.profiles where id = v_l2ref.referrer_id;

    if found and v_l2user.disabled_at is null then
      update public.referrals set l2_referrer_id = v_l2ref.referrer_id
       where id = v_row.id
      returning * into v_row;

      v_l2bonus := coalesce(public.config_int('referral_signup_bonus_points_l2'), 0)::bigint;

      if v_l2bonus > 0 then
        perform public.credit_points(
          v_l2ref.referrer_id, v_l2bonus, 'referral_signup', 'referral', v_row.id::text,
          jsonb_build_object('referee_id', p_referee_id, 'flat_rate', true, 'level', 2,
                             'through_referrer_id', v_referrer.id)
        );
        update public.referrals
           set l2_signup_bonus_points = v_l2bonus, l2_signup_bonus_paid_at = now()
         where id = v_row.id
        returning * into v_row;
      end if;
    end if;
  end if;

  if v_shared > 0 then
    perform public.record_fraud_signal(p_referee_id, 'self_referral_suspected',
      jsonb_build_object('referrer_id', v_referrer.id,
                         'shared', case when p_fingerprint is not null then 'device' else 'ip' end));
    perform public.record_fraud_signal(v_referrer.id, 'self_referral_suspected',
      jsonb_build_object('referee_id', p_referee_id));
  end if;

  return v_row;
end;
$function$
;

revoke execute on function public.apply_referral_code(uuid, text, inet, text)
  from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 5. check_referral_activation — stage two, now paying two levels
-- ---------------------------------------------------------------------------
--
-- Restated from the LIVE definition (migration 081). The second-level bonus
-- goes to whoever `l2_referrer_id` recorded at signup.
--
-- IT IS FILLED IN HERE WHEN IT IS STILL NULL, because the links do not have to
-- arrive in order: P can invite R on Monday and be invited by G themselves on
-- Tuesday. Nobody was upstream when R signed up, so no signup bonus was owed
-- and none is paid retrospectively — but by the time R activates, G is
-- genuinely one level above, and the commission arm (which resolves the hop
-- live, at the moment of the purchase) would pay them. Leaving this null would
-- mean the same relationship earned a commission but not an activation bonus.
-- Set once, never overwritten: it is what the claw-back traces.

CREATE OR REPLACE FUNCTION public.check_referral_activation(p_referee_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_ref     public.referrals;
  v_needed  int;
  v_done    int;
  v_bonus   bigint;
  v_l2user  public.profiles;
  v_l2ref   public.referrals;
  v_l2id    uuid;
  v_l2bonus bigint := 0;
begin
  select * into v_ref from public.referrals
   where referee_id = p_referee_id and status = 'pending'
   for update;

  if not found then
    return false;
  end if;

  v_needed := public.config_int('referral_activation_ads_required')::int;

  select count(*) into v_done
    from public.points_ledger l
   where l.user_id = p_referee_id
     and l.entry_type in ('ad_view', 'survey');

  if v_done < v_needed then
    return false;
  end if;

  -- FLAT, as with the signup bonus.
  v_bonus := coalesce(public.config_int('referral_activation_bonus_points'), 0)::bigint;

  if v_bonus > 0 then
    perform public.credit_points(
      v_ref.referrer_id, v_bonus, 'referral_activation', 'referral', v_ref.id::text,
      jsonb_build_object('referee_id', p_referee_id, 'ads_completed', v_done,
                         'flat_rate', true, 'level', 1)
    );
  end if;

  -- SECOND LEVEL (migration 083).
  v_l2id := v_ref.l2_referrer_id;

  if v_l2id is null then
    v_l2ref := public.second_level_referral(p_referee_id);
    v_l2id  := v_l2ref.referrer_id;
  end if;

  if v_l2id is not null then
    select * into v_l2user from public.profiles where id = v_l2id;

    if found and v_l2user.disabled_at is null then
      v_l2bonus := coalesce(public.config_int('referral_activation_bonus_points_l2'), 0)::bigint;

      if v_l2bonus > 0 then
        perform public.credit_points(
          v_l2id, v_l2bonus, 'referral_activation', 'referral', v_ref.id::text,
          jsonb_build_object('referee_id', p_referee_id, 'ads_completed', v_done,
                             'flat_rate', true, 'level', 2,
                             'through_referrer_id', v_ref.referrer_id)
        );
      end if;
    else
      -- Disabled, or gone. Nothing is paid and nothing is attributed to them.
      v_l2bonus := 0;
      v_l2id    := v_ref.l2_referrer_id;
    end if;
  end if;

  update public.referrals
     set status = 'activated',
         activation_bonus_points = v_bonus,
         activation_bonus_paid_at = case when v_bonus > 0 then now() end,
         l2_referrer_id = v_l2id,
         l2_activation_bonus_points = v_l2bonus,
         l2_activation_bonus_paid_at = case when v_l2bonus > 0 then now() end,
         ads_at_activation = v_done,
         updated_at = now()
   where id = v_ref.id;

  return true;
end;
$function$
;

revoke execute on function public.check_referral_activation(uuid)
  from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 6. pay_one_referral_commission — one beneficiary, one level
-- ---------------------------------------------------------------------------
--
-- Extracted so the two levels cannot drift apart. Every limit that used to be
-- inline in `pay_referral_purchase_commission` lives here and therefore
-- applies to both levels by construction: the disabled-beneficiary refusal,
-- the self-payment refusal, the lifetime cap, and the clamp to what is left of
-- the sale.
--
-- p_headroom is the money still available on this sale. At level one that is
-- the whole sale; at level two it is the sale minus whatever level one took.
-- This is what keeps the invariant that a referral never costs more than the
-- purchase that produced it, now that two people can be paid for one purchase.

create or replace function public.pay_one_referral_commission(
  p_payment_id         uuid,
  p_referral_id        uuid,     -- the link that entitles the beneficiary
  p_source_referral_id uuid,     -- the link that produced the purchase
  p_beneficiary        uuid,
  p_level              smallint,
  p_percent            numeric,
  p_gross              bigint,
  p_headroom           bigint,
  p_scope              text
)
returns public.referral_commissions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pay    public.subscription_payments;
  v_user   public.profiles;
  v_cap    bigint;
  v_paid   bigint;
  v_points bigint;
  v_row    public.referral_commissions;
begin
  if p_percent is null or p_percent <= 0 or p_headroom <= 0 then
    return null;
  end if;

  select * into v_pay from public.subscription_payments where id = p_payment_id;
  if not found or v_pay.status <> 'confirmed' then
    return null;
  end if;

  -- Nobody is paid a commission on their own purchase, at either level. At
  -- level two this is the cycle guard doing real work.
  if p_beneficiary = v_pay.user_id then
    return null;
  end if;

  select * into v_user from public.profiles where id = p_beneficiary;
  if not found or v_user.disabled_at is not null then
    -- The same refusal `apply_referral_code` makes, made here rather than by
    -- adding entry types to the guard list inside credit_points.
    return null;
  end if;

  v_points := floor(p_gross * (p_percent / 100.0))::bigint;

  -- THE STRUCTURAL LIMIT: never more than the sale, and never more than what
  -- is left of it.
  v_points := least(v_points, p_headroom);

  if v_points <= 0 then
    return null;
  end if;

  -- Lifetime cap, counted across BOTH levels of the same link. A referee who
  -- has already generated the ceiling for their referrer must not become
  -- worth another ceiling by inviting people themselves.
  v_cap := coalesce(public.config_int('referral_purchase_commission_cap_points'), 0);
  if v_cap > 0 then
    select coalesce(sum(points), 0) into v_paid
      from public.referral_commissions
     where referral_id = p_referral_id and reversed_at is null;

    v_points := least(v_points, v_cap - v_paid);
    if v_points <= 0 then
      return null;
    end if;
  end if;

  -- reference (subscription_payment, payment id) is load-bearing: it is the
  -- first of the two idempotency guards, via points_ledger_source_once_idx,
  -- which raises 23505 if this same beneficiary is ever credited for this same
  -- payment twice. The unique (payment_id, level) is the other.
  perform public.credit_points(
    p_beneficiary,
    v_points,
    'referral_purchase',
    'subscription_payment',
    v_pay.id::text,
    jsonb_build_object(
      'referral_id',  p_referral_id,
      'referee_id',   v_pay.user_id,
      'tier_id',      v_pay.tier_id,
      'amount_minor', v_pay.amount_minor,
      'percent',      p_percent,
      'flat_rate',    true,
      'level',        p_level,
      'scope',        p_scope
    )
  );

  insert into public.referral_commissions
    (referral_id, source_referral_id, level, referrer_id, referee_id, payment_id, tier_id,
     amount_minor, currency_code, percent_applied, tier_multiplier,
     scope_at_payment, points)
  values
    (p_referral_id, p_source_referral_id, p_level, p_beneficiary, v_pay.user_id, v_pay.id, v_pay.tier_id,
     v_pay.amount_minor, v_pay.currency_code, p_percent, 1.000,
     p_scope, v_points)
  returning * into v_row;

  perform public.create_notification(
    p_beneficiary,
    'payout',
    'You earned a referral commission',
    case when p_level = 1
      then 'Someone you invited bought a plan. '
      else 'Someone invited by a person you invited bought a plan. '
    end || v_points::text || ' points have been added to your balance.',
    jsonb_build_object('referral_commission_id', v_row.id, 'points', v_points, 'level', p_level)
  );

  return v_row;
end;
$$;

comment on function public.pay_one_referral_commission(uuid, uuid, uuid, uuid, smallint, numeric, bigint, bigint, text) is
  'Pays one referral commission to one beneficiary at one level. Holds every limit that applies to both levels, so they cannot drift apart.';

revoke execute on function public.pay_one_referral_commission(uuid, uuid, uuid, uuid, smallint, numeric, bigint, bigint, text)
  from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 7. pay_referral_purchase_commission — orchestrates the two levels
-- ---------------------------------------------------------------------------
--
-- Restated from the LIVE definition (migration 081). The scope decision, the
-- gross, and the rejected-referral refusal are unchanged and are made ONCE:
-- they are facts about the purchase, not about who is being paid, so a renewal
-- that earns nothing at level one must earn nothing at level two either.
--
-- Still returns the FIRST-level commission row (or null), which is what
-- `confirm_subscription_payment` and the tests already expect. The second-level
-- row is found through `referral_commissions`.

CREATE OR REPLACE FUNCTION public.pay_referral_purchase_commission(p_payment_id uuid)
 RETURNS referral_commissions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_pay     public.subscription_payments;
  v_ref     public.referrals;
  v_l2ref   public.referrals;
  v_scope   text;
  v_percent numeric;
  v_pct2    numeric;
  v_rate    bigint;
  v_gross   bigint;
  v_earns   boolean;
  v_row     public.referral_commissions;
  v_row2    public.referral_commissions;
  v_taken   bigint := 0;
begin
  select * into v_pay from public.subscription_payments where id = p_payment_id for update;
  if not found then
    raise exception 'Payment not found' using errcode = 'check_violation';
  end if;

  -- Only a payment that actually settled earns anything.
  if v_pay.status <> 'confirmed' then
    return null;
  end if;

  v_percent := coalesce(public.config_decimal('referral_purchase_commission_percent'), 0);
  v_pct2    := coalesce(public.config_decimal('referral_purchase_commission_percent_l2'), 0);

  if v_percent <= 0 and v_pct2 <= 0 then
    return null;                                   -- stage switched off at both levels
  end if;

  -- A rejected referral earns nothing further. Pending and activated both do.
  select * into v_ref from public.referrals
   where referee_id = v_pay.user_id and status <> 'rejected'
   for update;
  if not found then
    return null;
  end if;

  -- Belt and braces. The table's own CHECK makes this impossible, but this is
  -- the money path and self-referral is the fraud it would be built for.
  if v_ref.referrer_id = v_ref.referee_id then
    return null;
  end if;

  -- --- Scope -----------------------------------------------------------
  -- Decided once, for the purchase. Both levels earn on the same purchases.
  v_scope := coalesce(
    (select value from public.app_config where key = 'referral_purchase_commission_scope'),
    'new_plans'
  );

  if v_scope = 'all' then
    v_earns := true;

  elsif v_scope = 'first' then
    v_earns := not exists (
      select 1 from public.subscription_payments p
       where p.user_id = v_pay.user_id
         and p.status = 'confirmed'
         and p.id <> v_pay.id
    );

  else
    -- 'new_plans' — the first time they buy THIS plan.
    v_earns := not exists (
      select 1 from public.subscription_payments p
       where p.user_id = v_pay.user_id
         and p.tier_id = v_pay.tier_id
         and p.status = 'confirmed'
         and p.id <> v_pay.id
    );
  end if;

  if not v_earns then
    return null;
  end if;

  -- --- The sale, in points ----------------------------------------------
  -- Recomputed from the payment rather than the tier price, so a plan
  -- re-priced between purchase and confirmation cannot pay a commission on
  -- money never received.
  v_rate  := public.config_int('points_per_currency_unit');
  v_gross := (v_pay.amount_minor * v_rate) / 100;

  -- --- Level one ---------------------------------------------------------
  v_row := public.pay_one_referral_commission(
    p_payment_id, v_ref.id, v_ref.id, v_ref.referrer_id,
    1::smallint, v_percent, v_gross, v_gross, v_scope
  );
  v_taken := coalesce(v_row.points, 0);

  -- --- Level two ---------------------------------------------------------
  -- Paid out of the remainder. If level one took the whole sale there is
  -- nothing here to pay, and `pay_one_referral_commission` returns null.
  v_l2ref := public.second_level_referral(v_pay.user_id);

  if v_l2ref.id is not null then
    v_row2 := public.pay_one_referral_commission(
      p_payment_id, v_l2ref.id, v_ref.id, v_l2ref.referrer_id,
      2::smallint, v_pct2, v_gross, v_gross - v_taken, v_scope
    );
  end if;

  return coalesce(v_row, v_row2);
end;
$function$
;

revoke execute on function public.pay_referral_purchase_commission(uuid)
  from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 8. claw_back_referral_points — take back what is actually there
-- ---------------------------------------------------------------------------
--
-- Extracted because a rejection now unwinds money from two different people
-- and the clamp must be identical for both. Unchanged in behaviour from
-- migration 021: a negative balance is not representable, and chasing a
-- shortfall through the ledger would be worse than recording that it could not
-- be fully recovered.

create or replace function public.claw_back_referral_points(
  p_user        uuid,
  p_amount      bigint,
  p_referral_id uuid,
  p_meta        jsonb
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bal   bigint;
  v_taken bigint;
begin
  if p_user is null or coalesce(p_amount, 0) <= 0 then
    return 0;
  end if;

  select coalesce(balance, 0) into v_bal from public.user_balances where user_id = p_user;
  v_taken := least(p_amount, coalesce(v_bal, 0));

  if v_taken <= 0 then
    return 0;
  end if;

  perform public.debit_points(
    p_user, v_taken, 'admin_adjustment', 'referral_reversal', p_referral_id::text,
    p_meta || jsonb_build_object('owed', p_amount, 'recovered', v_taken)
  );

  return v_taken;
end;
$$;

revoke execute on function public.claw_back_referral_points(uuid, bigint, uuid, jsonb)
  from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 9. reject_referral — unwinds BOTH levels
-- ---------------------------------------------------------------------------
--
-- Rejecting the link X (P -> R) now has to find every payment X caused, and
-- those payments went to two different people:
--
--   P was paid   X's signup and activation bonuses
--                every commission whose referral_id is X (either level: at
--                level two, referral_id is the beneficiary's OWN link, so this
--                one filter is correct for both)
--                the second-level bonuses X's rejection strips from links
--                below it — rows where P is the referrer and P's own referrer
--                is the second-level beneficiary
--
--   X.l2_referrer_id was paid   X's own second-level bonuses
--                               commissions sourced by X at level two
--
-- The REFEREE still keeps everything they earned by watching, and their
-- subscription is untouched: they paid real money for it and may simply have
-- been recruited by somebody abusive.
--
-- `l2_reversed_at` is what stops a bonus being clawed back twice when both
-- ends of a broken chain are rejected.

create or replace function public.reject_referral(
  p_admin_id    uuid,
  p_referral_id uuid,
  p_reason      text
)
returns public.referrals
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ref        public.referrals;
  v_commission bigint;
  v_through    bigint;
  v_total      bigint;
  v_l2_own     bigint;
  v_l2_comm    bigint;
begin
  if p_reason is null or length(trim(p_reason)) < 3 then
    raise exception 'A reason is required' using errcode = 'check_violation';
  end if;

  select * into v_ref from public.referrals where id = p_referral_id for update;
  if not found then
    raise exception 'Referral not found' using errcode = 'check_violation';
  end if;
  if v_ref.status = 'rejected' then
    raise exception 'Already rejected' using errcode = 'check_violation';
  end if;

  -- ---- What the referrer must give back -------------------------------
  select coalesce(sum(points), 0) into v_commission
    from public.referral_commissions
   where referral_id = p_referral_id and reversed_at is null;

  -- Second-level bonuses this link earned the referrer on the links below it.
  select coalesce(sum(l2_signup_bonus_points + l2_activation_bonus_points), 0)
    into v_through
    from public.referrals
   where referrer_id = v_ref.referee_id
     and l2_referrer_id = v_ref.referrer_id
     and l2_reversed_at is null;

  v_total := coalesce(v_ref.signup_bonus_points, 0)
           + coalesce(v_ref.activation_bonus_points, 0)
           + v_commission
           + v_through;

  perform public.claw_back_referral_points(
    v_ref.referrer_id, v_total, p_referral_id,
    jsonb_build_object('reason', trim(p_reason), 'rejected_by', p_admin_id,
                       'commission_points', v_commission,
                       'second_level_points', v_through, 'as', 'referrer')
  );

  -- ---- What the second-level referrer must give back -------------------
  if v_ref.l2_referrer_id is not null then
    v_l2_own := case when v_ref.l2_reversed_at is null
                     then coalesce(v_ref.l2_signup_bonus_points, 0)
                          + coalesce(v_ref.l2_activation_bonus_points, 0)
                     else 0 end;

    select coalesce(sum(points), 0) into v_l2_comm
      from public.referral_commissions
     where source_referral_id = p_referral_id
       and level = 2
       and reversed_at is null;

    perform public.claw_back_referral_points(
      v_ref.l2_referrer_id, v_l2_own + v_l2_comm, p_referral_id,
      jsonb_build_object('reason', trim(p_reason), 'rejected_by', p_admin_id,
                         'commission_points', v_l2_comm,
                         'second_level_points', v_l2_own, 'as', 'second_level')
    );
  end if;

  -- ---- Mark everything reversed ---------------------------------------
  -- Whether or not the balance covered the claw-back: the money is no longer
  -- owed, and the lifetime cap must not keep counting points that have been
  -- reversed.
  update public.referral_commissions
     set reversed_at = now()
   where reversed_at is null
     and (referral_id = p_referral_id
          or (source_referral_id = p_referral_id and level = 2));

  update public.referrals
     set l2_reversed_at = now()
   where l2_reversed_at is null
     and l2_referrer_id is not null
     and (id = p_referral_id
          or (referrer_id = v_ref.referee_id and l2_referrer_id = v_ref.referrer_id));

  update public.referrals
     set status = 'rejected', rejected_reason = trim(p_reason),
         rejected_by = p_admin_id, updated_at = now()
   where id = p_referral_id
  returning * into v_ref;

  return v_ref;
end;
$$;

revoke execute on function public.reject_referral(uuid, uuid, text) from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 10. get_referral_summary — the second level is visible or it is a secret
-- ---------------------------------------------------------------------------
--
-- Drop and recreate: two more columns, which CREATE OR REPLACE cannot do.
--
-- `points_earned` stays the honest total of everything the referral programme
-- has paid this user, which now includes second-level bonuses. `level_two_*`
-- break out the part that came from people they did not invite themselves,
-- because a screen that shows one number and calls it "from your invites"
-- would be describing the first level only.

drop function if exists public.get_referral_summary(uuid);

create or replace function public.get_referral_summary(p_user_id uuid)
returns table (
  referral_code     text,
  total_referred    int,
  activated_count   int,
  pending_count     int,
  points_earned     bigint,
  ads_required      int,
  purchases_count   int,
  commission_points bigint,
  level_two_count   int,
  level_two_points  bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_caller uuid := (select auth.uid());
begin
  if v_caller is not null and v_caller <> p_user_id and not public.is_admin() then
    raise exception 'Not authorised' using errcode = 'insufficient_privilege';
  end if;

  return query
  select
    p.referral_code,
    coalesce(r.total, 0)::int,
    coalesce(r.activated, 0)::int,
    coalesce(r.pending, 0)::int,
    (coalesce(r.points, 0) + coalesce(c.points, 0) + coalesce(l2.bonus_points, 0))::bigint,
    public.config_int('referral_activation_ads_required')::int,
    coalesce(c.purchases, 0)::int,
    coalesce(c.points, 0)::bigint,
    coalesce(l2.people, 0)::int,
    (coalesce(l2.bonus_points, 0) + coalesce(c.l2_points, 0))::bigint
  from public.profiles p
  left join (
    select referrer_id,
           count(*) filter (where status <> 'rejected')  as total,
           count(*) filter (where status = 'activated')  as activated,
           count(*) filter (where status = 'pending')    as pending,
           sum(case when status = 'rejected' then 0
                    else signup_bonus_points + activation_bonus_points end) as points
    from public.referrals group by referrer_id
  ) r on r.referrer_id = p.id
  left join (
    select referrer_id,
           count(*)                                        as purchases,
           sum(points)                                     as points,
           sum(points) filter (where level = 2)            as l2_points
    from public.referral_commissions
    where reversed_at is null
    group by referrer_id
  ) c on c.referrer_id = p.id
  left join (
    select l2_referrer_id,
           count(*) filter (where status <> 'rejected')    as people,
           sum(case when l2_reversed_at is not null then 0
                    else l2_signup_bonus_points + l2_activation_bonus_points end) as bonus_points
    from public.referrals
    where l2_referrer_id is not null
    group by l2_referrer_id
  ) l2 on l2.l2_referrer_id = p.id
  where p.id = p_user_id;
end;
$$;

revoke execute on function public.get_referral_summary(uuid) from public, anon;


-- ---------------------------------------------------------------------------
-- 11. The table comments that said "impossible by construction"
-- ---------------------------------------------------------------------------
--
-- They were true and they are now wrong by one level. Left uncorrected, the
-- next person to read the schema would take them as a guarantee.

comment on table public.referrals is
  'Two-level referrals. A referrer earns from the people they invited, and (migration 083) from the people those people invite — and from nobody further. The depth limit is structural: second_level_referral does exactly one upward hop, with no recursion, so a third level is unexpressible rather than disabled.';

comment on table public.referral_commissions is
  'Referral commissions on subscription payments, at most one per (payment, level). Percentage and amount are frozen at payment time so re-pricing a plan or changing config never rewrites what was already paid.';
