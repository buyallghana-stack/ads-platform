-- ============================================================================
-- Migration 122 — both commission levels are a percentage of the TOTAL sale
--
-- Operator, 2026-08-06: *"it should be a percentage of the total amount of the
-- training program as determined by me across the 2 levels"*, and confirmed
-- uniform — vendor products work the same way, not only training.
--
-- This REVERSES the rule approved earlier the same day, and the reversal is
-- deliberate rather than a correction of a mistake. What changes:
--
--   was   l1 = round(base × l1%)
--         l2 = round((base − l1) × l2%)        ← a slice of what was LEFT
--   now   l1 = round(base × l1%)
--         l2 = round(base × l2%)               ← both off the same figure
--
-- On a GHS 400 sale at 20% and 5%: level two goes from GHS 16.00 to GHS 20.00,
-- and the total paid out from GHS 96.00 to GHS 100.00.
--
-- ---------------------------------------------------------------------------
-- WHERE THE "CANNOT EXCEED THE SALE" GUARANTEE NOW LIVES
--
-- The remainder rule made overpayment ARITHMETICALLY impossible: level two
-- could only ever take a slice of what level one had not taken, whatever the
-- rates were. Paying both off the total moves that guarantee into
-- CONFIGURATION — it holds because `affiliate_programs_together_sane` refuses
-- a rate pair summing above 100%.
--
-- That constraint exists and is tested, so the property survives. But it is
-- worth writing down that it is now a different KIND of guarantee: the old one
-- could not be misconfigured, the new one is enforced by refusing the
-- misconfiguration. If that constraint is ever loosened, this arithmetic
-- becomes capable of paying out more than came in.
--
-- And because two independent roundings can each round up, level two is
-- CLAMPED to whatever is left after level one. At rates summing to exactly
-- 100% that is the difference between paying the sale and paying the sale plus
-- one pesewa — small, but it would show up in reconciliation as a ledger that
-- does not balance, which is a bad way to learn about a rounding rule.
-- ============================================================================

create or replace function public.pay_conversion_commissions(p_conversion_id uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conv    public.conversions;
  v_program public.affiliate_programs;
  v_l1      bigint;
  v_l2      bigint;
  v_status  public.commission_status;
  v_clears  timestamptz;
  v_written int := 0;
begin
  select * into v_conv from public.conversions where id = p_conversion_id;
  if not found then
    raise exception 'Unknown conversion' using errcode = 'check_violation';
  end if;

  if v_conv.status <> 'attributed' then
    return 0;
  end if;

  select * into v_program from public.affiliate_programs where id = v_conv.program_id;
  if not found then
    return 0;
  end if;

  if v_program.hold_days > 0 then
    v_status := 'pending';
    v_clears := now() + make_interval(days => v_program.hold_days);
  else
    v_status := 'cleared';
    v_clears := null;
  end if;

  v_l1 := round(v_conv.base_minor * v_conv.l1_rate / 100.0);

  if v_l1 > 0 then
    insert into public.commission_ledger
      (affiliate_id, conversion_id, level, entry_type, amount_minor, status, clears_at,
       idempotency_key)
    values
      (v_conv.affiliate_id, v_conv.id, 1, 'credit', v_l1, v_status, v_clears,
       'conversion:' || v_conv.id::text || ':level:1')
    on conflict (idempotency_key) do nothing;
    v_written := v_written + 1;
  end if;

  if v_conv.l2_affiliate_id is not null
     and v_conv.l2_rate is not null
     and coalesce(v_conv.l2_depth_at_conversion, 0) >= 2 then

    /* BOTH LEVELS OFF THE SAME BASE, per the operator's decision. The clamp is
       the only thing standing between two independent roundings and a ledger
       that pays out one pesewa more than the sale brought in. */
    v_l2 := least(
      round(v_conv.base_minor * v_conv.l2_rate / 100.0),
      greatest(v_conv.base_minor - v_l1, 0)
    );

    if v_l2 > 0 then
      insert into public.commission_ledger
        (affiliate_id, conversion_id, level, entry_type, amount_minor, status, clears_at,
         idempotency_key)
      values
        (v_conv.l2_affiliate_id, v_conv.id, 2, 'credit', v_l2, v_status, v_clears,
         'conversion:' || v_conv.id::text || ':level:2')
      on conflict (idempotency_key) do nothing;
      v_written := v_written + 1;
    end if;
  end if;

  return v_written;
end;
$$;

revoke execute on function public.pay_conversion_commissions(uuid) from public, anon, authenticated;
grant execute on function public.pay_conversion_commissions(uuid) to service_role;
