-- ============================================================================
-- Migration 241: referral commission is paid on cash only
--
-- Operator, 2026-09-25: *"referral commission should be cash only but for the
-- tasks milestone it doesnt matter once the user has an active plan it is
-- counted."*
--
--   paid wholly from the balance (method 'balance')   no commission
--   part balance, part Paystack (migration 240)        commission on the cash
--                                                      part only, which is
--                                                      already what it gets:
--                                                      the commission is worked
--                                                      out from amount_minor,
--                                                      and on that row
--                                                      amount_minor IS the cash
--   Paystack in full                                    unchanged
--
-- Task milestones are not touched: they count plans held, and a plan bought
-- from the balance is a plan held.
--
-- ⚠️ RENAMED, NOT RETYPED. The last migration to define this function is from
-- July, and this repository has been caught twice by a migration file that no
-- longer matched the body actually running (see 236). So the live function is
-- renamed as it stands, whatever its body is, and a guard with the original
-- name sits in front of it. `confirm_subscription_payment` calls it by name,
-- so it reaches the guard without being edited.
-- ============================================================================

alter function public.pay_referral_purchase_commission(uuid)
  rename to pay_referral_purchase_commission_on_cash;

revoke execute on function public.pay_referral_purchase_commission_on_cash(uuid)
  from public, anon, authenticated;

create function public.pay_referral_purchase_commission(p_payment_id uuid)
returns public.referral_commissions
language plpgsql
security definer
set search_path = ''
as $$
begin
  /* No cash came in, so there is nothing to pay a commission out of. */
  if exists (
    select 1 from public.subscription_payments
     where id = p_payment_id and method = 'balance'
  ) then
    return null;
  end if;

  return public.pay_referral_purchase_commission_on_cash(p_payment_id);
end;
$$;

revoke execute on function public.pay_referral_purchase_commission(uuid)
  from public, anon, authenticated;
grant  execute on function public.pay_referral_purchase_commission(uuid)
  to service_role;
