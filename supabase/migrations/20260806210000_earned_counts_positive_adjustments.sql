-- ============================================================================
-- Migration 132 — "earned all time" must never be less than the balance
--
-- Found by looking at the built screen rather than by reading the code: an
-- affiliate whose balance came from a manual adjustment saw
--
--     Commission balance   GHS 248.00
--     Earned all time      GHS   0.00
--
-- Both figures were correct by their own definitions — `earned` counted only
-- `credit` rows, and an adjustment is not a credit — and together they were
-- nonsense. A balance cannot exceed what was ever earned. Anybody reading that
-- concludes the platform has lost track of their money, and they are right to.
--
-- It also poisoned earnings-per-click, which divides `earned` by clicks and so
-- reported GHS 0.00 per click for somebody holding GHS 248.
--
-- ---------------------------------------------------------------------------
-- WHY POSITIVE ADJUSTMENTS COUNT AND NEGATIVE ONES DO NOT
--
-- "Earned all time" answers a user's question, not an accountant's: how much
-- money has become mine. A goodwill payment or a correction in their favour is
-- money that became theirs, so it counts.
--
-- A NEGATIVE adjustment is money taken back, which is what `reversed` already
-- reports — so it is added there instead. Putting it in `earned` as a negative
-- would let a correction quietly reduce a lifetime total that people screenshot
-- and compare, and would hide a clawback in a figure labelled "earned".
--
-- Payouts stay out of both. Withdrawing money you earned does not un-earn it.
-- ============================================================================

create or replace function public.affiliate_dashboard(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_aff      public.affiliate_accounts;
  v_ent      record;
  v_state    text;
  v_balance  bigint := 0;
  v_pending  bigint := 0;
  v_earned   bigint := 0;
  v_reversed bigint := 0;
  v_paid     bigint := 0;
  v_clicks   int := 0;
  v_convs    int := 0;
  v_train    jsonb := '[]'::jsonb;
begin
  select * into v_aff
    from public.affiliate_accounts
   where user_id = p_user_id;

  if not found then
    return jsonb_build_object(
      'state', 'none',
      'training_offers', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'product_id', pr.id,
                 'slug',       pr.slug,
                 'title',      pr.title,
                 'level',      tp.level::text,
                 'depth',      tp.commission_depth,
                 'price_minor', public.product_price_minor(pr.id)
               ) order by pr.price_minor)
          from public.training_programs tp
          join public.products pr on pr.id = tp.product_id
         where pr.status = 'published'
      ), '[]'::jsonb)
    );
  end if;

  select e.commission_depth, e.expires_at, e.grace_ends_at, e.status,
         tp.level::text as level,
         greatest(0, floor(extract(epoch from (e.expires_at - now())) / 86400)::int) as days_left
    into v_ent
    from public.affiliate_entitlements e
    join public.training_programs tp on tp.id = e.training_program_id
   where e.affiliate_id = v_aff.id
     and e.status = 'active'
     and e.grace_ends_at > now()
   order by e.grace_ends_at desc
   limit 1;

  v_state := case
               when v_aff.status = 'suspended' then 'suspended'
               when v_aff.status = 'pending'   then 'pending'
               when v_ent.level is null        then 'lapsed'
               else 'active'
             end;

  v_balance := public.affiliate_balance_minor(v_aff.id);
  v_pending := public.affiliate_pending_minor(v_aff.id);

  /*
    Split by MEANING rather than by entry type, which is the change migration
    132 makes:

      earned    credits, plus adjustments in the affiliate's favour
      reversed  reversals, plus adjustments against them
      paid      payouts

    Summing these three gives the balance, which is the property that was
    violated before and is what makes the screen internally consistent.
  */
  select coalesce(sum(amount_minor) filter (
           where entry_type = 'credit'
              or (entry_type = 'adjustment' and amount_minor > 0)), 0),
         coalesce(sum(amount_minor) filter (
           where entry_type = 'reversal'
              or (entry_type = 'adjustment' and amount_minor < 0)), 0),
         coalesce(sum(amount_minor) filter (where entry_type = 'payout'), 0)
    into v_earned, v_reversed, v_paid
    from public.commission_ledger
   where affiliate_id = v_aff.id
     and status <> 'reversed';

  select count(*) into v_clicks
    from public.affiliate_clicks
   where affiliate_id = v_aff.id
     and created_at > now() - interval '30 days';

  select count(*) into v_convs
    from public.conversions
   where (affiliate_id = v_aff.id or l2_affiliate_id = v_aff.id)
     and status = 'attributed'
     and created_at > now() - interval '30 days';

  select coalesce(jsonb_agg(x order by x->>'title'), '[]'::jsonb) into v_train
    from (
      select jsonb_build_object(
               'product_id',  pr.id,
               'slug',        pr.slug,
               'title',       pr.title,
               'level',       tp.level::text,
               'percent',     public.training_completion_percent(p_user_id, pr.id),
               'threshold',   tp.activation_threshold_percent,
               'certificate', tp.certificate_enabled
             ) as x
        from public.affiliate_entitlements e
        join public.training_programs tp on tp.id = e.training_program_id
        join public.products pr on pr.id = tp.product_id
       where e.affiliate_id = v_aff.id
    ) s;

  return jsonb_build_object(
    'state',          v_state,
    'affiliate_id',   v_aff.id,
    'code',           v_aff.affiliate_code,
    'depth',          public.affiliate_depth_now(v_aff.id),
    'tier',           v_ent.level,
    'expires_at',     v_ent.expires_at,
    'grace_ends_at',  v_ent.grace_ends_at,
    'days_left',      v_ent.days_left,
    'balance_minor',  v_balance,
    'pending_minor',  v_pending,
    'earned_minor',   v_earned,
    'reversed_minor', -v_reversed,
    'paid_minor',     -v_paid,
    'clicks_30d',     v_clicks,
    'conversions_30d', v_convs,
    'training',       v_train,
    'payouts_enabled', coalesce((select value = 'true' from public.app_config
                                  where key = 'affiliate_payouts_enabled'), false),
    'payout_minimum_minor', coalesce((select value::bigint from public.app_config
                                       where key = 'commission_payout_minimum_minor'), 0)
  );
end;
$$;

-- ⚠️ `create or replace` re-grants EXECUTE to PUBLIC. Re-revoke every time.
revoke execute on function public.affiliate_dashboard(uuid) from public, anon, authenticated;
grant  execute on function public.affiliate_dashboard(uuid) to service_role;
