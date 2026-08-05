-- ============================================================================
-- Migration 130 — what the affiliate dashboard reads
--
-- One function returning one jsonb, rather than the eight queries the screen
-- would otherwise make. The audience is on mobile data on cheap handsets; the
-- app layout already goes out of its way to avoid a second round trip on every
-- page, and a dashboard that fired eight would undo that on the busiest screen
-- in the second business.
--
-- ---------------------------------------------------------------------------
-- THE BALANCE IS NOT RECOMPUTED HERE
--
-- The one thing this function must not do is invent a second definition of
-- "what you can withdraw". If this screen summed the ledger its own way and
-- `request_commission_payout` summed it another, a user would be shown a
-- withdrawable figure that the payout path then refuses — and the support
-- conversation that follows is unwinnable, because both numbers are real.
--
-- So it calls `affiliate_balance_minor` and `affiliate_pending_minor`, the
-- same functions the money path calls. If the definition of balance ever
-- changes, it changes in one place and this screen follows automatically.
--
-- ---------------------------------------------------------------------------
-- STATE IS RETURNED, NOT INFERRED
--
-- The screen has four states with no design precedent (DESIGN.md, call 6) —
-- none, pending, active, suspended — and three of them are reachable on day
-- one. Rather than let the UI derive the state from a scatter of nullable
-- fields (which is how a user ends up seeing "pending" and a payout button at
-- the same time), the function names the state itself and the UI switches on
-- one string.
--
-- `none` is a first-class state, not an error. Somebody who has never bought
-- training still opens this screen, because the mode switch is visible to
-- everyone — that is deliberate, it is how the second business advertises
-- itself.
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
    -- No account at all. The training courses are the whole content of the
    -- screen in this state, so they are what gets returned.
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

  /*
    The live entitlement: the one that still grants the right to promote.
    Ordered by grace end so that a renewal overlapping an old row picks the
    one that lasts longest, not whichever the planner happened to return.
  */
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
    Lifetime figures are split by entry type rather than netted, because the
    dashboard has to be able to SAY what happened. A single net number cannot
    explain a negative balance, and explaining it is the whole job of that
    state (DESIGN.md, call 6).
  */
  select coalesce(sum(amount_minor) filter (where entry_type = 'credit'), 0),
         coalesce(sum(amount_minor) filter (where entry_type = 'reversal'), 0),
         coalesce(sum(amount_minor) filter (where entry_type = 'payout'), 0)
    into v_earned, v_reversed, v_paid
    from public.commission_ledger
   where affiliate_id = v_aff.id
     and status <> 'reversed';

  -- Performance over the attribution window, so clicks and the conversions
  -- they could have produced cover the same period. Counting 30 days of
  -- clicks against all-time conversions would flatter the rate.
  select count(*) into v_clicks
    from public.affiliate_clicks
   where affiliate_id = v_aff.id
     and created_at > now() - interval '30 days';

  select count(*) into v_convs
    from public.conversions
   where (affiliate_id = v_aff.id or l2_affiliate_id = v_aff.id)
     and status = 'attributed'
     and created_at > now() - interval '30 days';

  -- Course progress. Returned in every state, not only `pending`: an active
  -- affiliate who stopped at 60% still has a course to finish and a
  -- certificate to earn at 100%.
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
    -- Reversals are stored negative. Flipped here so the UI never has to
    -- decide whether to print a minus sign in front of a number that already
    -- has one.
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

-- ---------------------------------------------------------------------------
-- Grants
--
-- Server-only, like every other Phase 2 read. It takes a user id rather than
-- reading auth.uid(), which is what lets a super admin's "view as user" look
-- render this screen correctly — the layout has already decided whose account
-- is being viewed, and this function answers about that account.
--
-- ⚠️ `create or replace function` re-grants EXECUTE to PUBLIC. Revoking is not
-- optional here: without it the anon key could read any affiliate's balance
-- and code by guessing user ids.
-- ---------------------------------------------------------------------------
revoke execute on function public.affiliate_dashboard(uuid) from public, anon, authenticated;
grant  execute on function public.affiliate_dashboard(uuid) to service_role;
