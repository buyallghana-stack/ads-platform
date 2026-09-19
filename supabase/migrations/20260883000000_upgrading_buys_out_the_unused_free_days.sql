-- ============================================================================
-- Migration 235 — buying a plan buys out the free days you never got to use
--
-- Operator, 2026-09-19: *"if a user sign up they get a free plan for 21 days,
-- however immediately they upgrade that plan vanishes, it is not fair for
-- users... Failure to watch an ad is not redeemable so that is a lost to him
-- not what we cover in paying the remaining balance."*
--
-- WHAT WAS ACTUALLY LOST. Nothing is confiscated: `credit_points` blocks new
-- free earning past the window but the balance stays, and migration 202 only
-- zeroes the daily CAP. What ends is the stream. The free window only applies
-- while `resolve_user_tier` returns the default tier, so the moment a plan is
-- live the remaining free days are gone, and the paid cap replaces the free
-- one rather than adding to it.
--
-- THE RULE, AND THE HALF THAT IS DELIBERATELY NOT PAID
--
--   entitlement  = free_earning_days x free cap x what a free ad pays
--   already gone = whole days since signing up
--   PAID OUT     = the days that remain, and only those
--
-- A day they were signed up for and chose not to watch is their own loss, not
-- something the business covers. Signed up on the 1st, bought on the 9th, so
-- 8 days are gone however they were spent and 13 days are bought out:
-- 1,300 points, GHS 13.
--
-- ⚠️ A TRIGGER, NOT AN EDIT TO `confirm_subscription_payment`. That function is
-- 160 lines and the last migration to touch one like it warned that a
-- signature rewritten from memory is accepted by `create or replace` as a
-- SECOND overload while the real one goes on running. Hooking the status
-- change costs nothing and leaves the money path untouched.
--
-- ⚠️ ONCE PER USER, BY PRIMARY KEY. `free_window_buyouts.user_id` is the
-- primary key, so a second plan, a renewal, a stack or a retried webhook
-- cannot pay it twice. This is the same guarantee the task rewards use, and it
-- is structural rather than a check somebody has to remember.
--
-- ⚠️ IT IS NOT PART OF WHAT A PLAN ADVERTISES. Operator decision the same day:
-- the buyout is a flat number, so it is worth 25% of a Bronze plan and 1.4% of
-- a Platinum one, and folding it into the advertised return would make Bronze
-- at GHS 85 pay back more than Bronze at GHS 105. That is the "more is better"
-- rule breaking, so it stays outside the ladder: the cards keep quoting what
-- the PLAN pays and this arrives beside it as points.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. The switch
-- ---------------------------------------------------------------------------

insert into public.app_config (key, value, value_type, min_value, max_value, is_public, description)
values
  ('free_window_buyout_enabled', 'true', 'bool', null, null, false,
   'When somebody buys their first plan, credit them for the free trial days they never got to use. Paid once per account, never on a renewal or a second plan, and nothing at all once the free window has run out. The amount follows free_earning_days and the free plan''s own ad count and rate, so retuning either moves it.')
on conflict (key) do nothing;


-- ---------------------------------------------------------------------------
-- 2. The record, which is also the guarantee
-- ---------------------------------------------------------------------------

create table if not exists public.free_window_buyouts (
  /* PRIMARY KEY, not just indexed. One per account is the whole safety
     property and it belongs in the schema, not in the function. */
  user_id      uuid primary key references public.profiles(id) on delete cascade,
  payment_id   uuid not null references public.subscription_payments(id) on delete cascade,
  days_unused  int  not null check (days_unused > 0),
  points       bigint not null check (points > 0),
  created_at   timestamptz not null default now()
);

comment on table public.free_window_buyouts is
  'One row per account that has been paid for its unused free trial days. The row IS the once-only guarantee. Deleted on a reversal so a genuine later purchase can be settled again, from that later date; the credit and the clawback both stay in points_ledger, which is where the history belongs.';

alter table public.free_window_buyouts enable row level security;

/* Read by its owner and by staff, like every other money record here. Written
   only by the definer function below, so there is no insert policy at all. */
drop policy if exists free_window_buyouts_read on public.free_window_buyouts;
create policy free_window_buyouts_read on public.free_window_buyouts
  for select using (user_id = (select auth.uid()) or public.is_admin());


-- ---------------------------------------------------------------------------
-- 3. What it is worth
-- ---------------------------------------------------------------------------
--
-- Split out so the admin, a test and the payer all get the same number from
-- one place, and so an operator can ask what an account is owed before
-- anything is written.

create or replace function public.free_window_buyout_points(p_user_id uuid)
returns table (days_unused int, points bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_days     int;
  v_joined   timestamptz;
  v_elapsed  int;
  v_free     public.tiers;
  v_base     bigint;
  v_per_ad   bigint;
begin
  days_unused := 0;
  points      := 0;

  v_days := public.config_int('free_earning_days')::int;
  if coalesce(v_days, 0) <= 0 then
    return next;
    return;
  end if;

  select p.created_at into v_joined from public.profiles p where p.id = p_user_id;
  if v_joined is null then
    return next;
    return;
  end if;

  /* WHOLE DAYS GONE, floored. Signed up on the 1st and buying on the 9th is 8,
     which leaves 13 of 21. The day they are buying on counts as still
     remaining, which is a day's generosity on purpose: migration 198 already
     resets today's counter so they get the full PAID allowance today, and
     charging them for the free side of the same day would take with one hand
     what that gave with the other. */
  v_elapsed := floor(extract(epoch from (now() - v_joined)) / 86400)::int;

  days_unused := greatest(v_days - v_elapsed, 0);
  if days_unused <= 0 then
    return next;
    return;
  end if;

  select * into v_free from public.tiers where is_default limit 1;
  if not found or coalesce(v_free.daily_ad_cap, 0) <= 0 then
    days_unused := 0;
    return next;
    return;
  end if;

  /* What one free ad pays, worked out the way the front page works it out:
     the base an ad is worth times the free plan's own rate. Not the average of
     what the live ads happen to pay, because this is settling an entitlement
     that was advertised, not reimbursing specific ads. */
  v_base   := coalesce(public.config_int('base_ad_points'), 100);
  v_per_ad := greatest(floor(v_base * v_free.reward_multiplier)::bigint, 1);

  points := days_unused::bigint * v_free.daily_ad_cap::bigint * v_per_ad;
  return next;
end;
$$;

revoke execute on function public.free_window_buyout_points(uuid) from public, anon, authenticated;
grant  execute on function public.free_window_buyout_points(uuid) to service_role;


-- ---------------------------------------------------------------------------
-- 4. Paying it
-- ---------------------------------------------------------------------------

create or replace function public.pay_free_window_buyout(p_payment_id uuid)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pay    public.subscription_payments;
  v_calc   record;
begin
  if not public.config_bool('free_window_buyout_enabled') then
    return 0;
  end if;

  select * into v_pay from public.subscription_payments where id = p_payment_id;
  if not found or v_pay.status <> 'confirmed' then
    return 0;
  end if;

  /* Already settled. Checked as well as constrained: reaching the insert and
     catching a unique violation would work, but it would also burn a
     subtransaction on every renewal anybody ever buys. */
  if exists (select 1 from public.free_window_buyouts b where b.user_id = v_pay.user_id) then
    return 0;
  end if;

  select * into v_calc from public.free_window_buyout_points(v_pay.user_id);
  if coalesce(v_calc.points, 0) <= 0 then
    return 0;
  end if;

  /* The row FIRST, so two webhooks arriving together cannot both credit: the
     primary key makes the loser fail here rather than after the points have
     been written. */
  insert into public.free_window_buyouts (user_id, payment_id, days_unused, points)
  values (v_pay.user_id, p_payment_id, v_calc.days_unused, v_calc.points);

  perform public.credit_points(
    v_pay.user_id,
    v_calc.points,
    'free_window_buyout',
    'subscription_payment',
    p_payment_id::text,
    jsonb_build_object(
      'days_unused', v_calc.days_unused,
      'free_earning_days', public.config_int('free_earning_days'),
      'tier_id', v_pay.tier_id
    ),
    /* NOT against the daily ad cap. This is not an ad being watched, and
       counting it would eat the allowance they just paid for. */
    false
  );

  return v_calc.points;
end;
$$;

revoke execute on function public.pay_free_window_buyout(uuid) from public, anon, authenticated;
grant  execute on function public.pay_free_window_buyout(uuid) to service_role;


-- ---------------------------------------------------------------------------
-- 5. Taking it back
-- ---------------------------------------------------------------------------
--
-- A reversal already revokes the plan and the referral bonus. This is the same
-- money and goes the same way.

create or replace function public.reverse_free_window_buyout(p_payment_id uuid)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.free_window_buyouts;
begin
  select * into v_row from public.free_window_buyouts
   where payment_id = p_payment_id for update;
  if not found then
    return 0;
  end if;

  begin
    /* ⚠️ A DIFFERENT `reference_type` FROM THE CREDIT, and it has to be.
       `points_ledger_source_once_idx` is unique on
       (user_id, entry_type, reference_type, reference_id) and is the last line
       of defence against paying the same thing twice. A clawback quoting the
       same four values as the credit it reverses collides with it, and the
       first version of this function did exactly that: the reversal looked
       like a duplicate credit and was refused. Same payment id, so the pair is
       still one story in the statement. */
    perform public.debit_points(
      v_row.user_id, v_row.points, 'free_window_buyout',
      'subscription_payment_reversal', p_payment_id::text,
      jsonb_build_object('reversal', true, 'days_unused', v_row.days_unused)
    );
  exception when others then
    /* `debit_points` refuses to take a balance below zero, so a user who has
       already withdrawn it cannot be clawed back here. Said out loud rather
       than swallowed, exactly as the referral clawback does, because the
       alternative is a silent hole in the reward pool. */
    insert into public.system_alerts (severity, code, message, context)
    values ('warning', 'free_window_buyout_not_recovered',
            'A reversed payment''s free trial buyout could not be taken back.',
            jsonb_build_object('payment_id', p_payment_id, 'user_id', v_row.user_id,
                               'points', v_row.points, 'error', sqlerrm));
  end;

  /* DELETED, not flagged. The ledger holds both the credit and the clawback,
     so the history survives, and leaving the row would bar a genuine later
     purchase from ever being settled. Recomputed from that later date, which
     is correct: by then fewer free days remain. */
  delete from public.free_window_buyouts where payment_id = p_payment_id;

  return v_row.points;
end;
$$;

revoke execute on function public.reverse_free_window_buyout(uuid) from public, anon, authenticated;
grant  execute on function public.reverse_free_window_buyout(uuid) to service_role;


-- ---------------------------------------------------------------------------
-- 6. The hook
-- ---------------------------------------------------------------------------

create or replace function public.trg_free_window_buyout()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'confirmed'
     and (tg_op = 'INSERT' or old.status is distinct from 'confirmed') then
    /* ⚠️ NEVER FAIL THE PURCHASE. A bonus that cannot be paid must not roll
       back a plan somebody has already been charged for. The referral
       commission is wrapped for the same reason, two lines below where this
       ends up running. */
    begin
      perform public.pay_free_window_buyout(new.id);
    exception when others then
      insert into public.system_alerts (severity, code, message, context)
      values ('warning', 'free_window_buyout_failed',
              'A plan was bought but the free trial buyout could not be paid.',
              jsonb_build_object('payment_id', new.id, 'error', sqlerrm, 'sqlstate', sqlstate));
    end;

  elsif new.status = 'refunded' and old.status is distinct from 'refunded' then
    begin
      perform public.reverse_free_window_buyout(new.id);
    exception when others then
      insert into public.system_alerts (severity, code, message, context)
      values ('warning', 'free_window_buyout_reversal_failed',
              'A payment was reversed but the free trial buyout could not be taken back.',
              jsonb_build_object('payment_id', new.id, 'error', sqlerrm, 'sqlstate', sqlstate));
    end;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_free_window_buyout on public.subscription_payments;
create trigger trg_free_window_buyout
  after insert or update of status on public.subscription_payments
  for each row execute function public.trg_free_window_buyout();
