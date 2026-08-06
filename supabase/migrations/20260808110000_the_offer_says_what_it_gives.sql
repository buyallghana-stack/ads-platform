-- ============================================================================
-- Migration 150 — the join screen can describe what it is selling
--
-- `affiliate_dashboard`'s `none` state returns `training_offers`: id, slug,
-- title, level, depth, price. That is enough to render two buttons and not
-- enough to render two OFFERS.
--
-- The join screen is the moment somebody decides to pay GHS 150 or GHS 400,
-- and the difference between the two is entirely in fields this read does not
-- carry: how long access lasts, whether a certificate is issued, how much of
-- the course must be finished before the account switches on, and what a
-- renewal costs afterwards. Without them the screen either says nothing (two
-- prices, no reasons) or says something invented.
--
-- Every field here already exists on `training_programs`. Nothing is computed
-- and nothing is stored; this is a wider SELECT.
--
-- ---------------------------------------------------------------------------
-- WHY `description` AND `cover_path` COME TOO
--
-- The reference gives each plan a sentence under its name and the screen has a
-- cover image at the top. Both live on `products` and were simply not selected.
--
-- ---------------------------------------------------------------------------
-- WHY THE OFFER LIST IS UNCHANGED IN EVERY OTHER RESPECT
--
-- Still ordered by price ascending, still only `published` programs, still an
-- empty array rather than null when there is nothing on sale. A join screen
-- with no offers is a real state — it is what every user sees before the
-- operator publishes — and it must render as "nothing on sale yet", not as a
-- crash.
-- ============================================================================

create or replace function public.affiliate_dashboard(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
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
                 'product_id',   pr.id,
                 'slug',         pr.slug,
                 'title',        pr.title,
                 'description',  pr.description,
                 'cover_path',   pr.cover_path,
                 'level',        tp.level::text,
                 'depth',        tp.commission_depth,
                 'price_minor',  public.product_price_minor(pr.id),
                 'list_price_minor', pr.price_minor,
                 'validity_days',    tp.validity_days,
                 'grace_days',       tp.grace_days,
                 'renewal_price_minor', tp.renewal_price_minor,
                 'threshold',    tp.activation_threshold_percent,
                 'certificate',  tp.certificate_enabled,
                 'lessons',      (select count(*)
                                    from public.lessons l
                                    join public.course_sections s on s.id = l.section_id
                                   where s.product_id = pr.id)
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

  /* Split by MEANING, not by entry type (migration 132): earned counts credits
     plus adjustments in the affiliate's favour, so the three sum to the
     balance and the screen is internally consistent. */
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

  /* The entitled programs, with the fields the dashboard card needs. */
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
$function$;

comment on function public.affiliate_dashboard(uuid) is
  'One read for the affiliate home. In the `none` state the offer list carries everything the join screen needs to describe what it is selling — validity, certificate, activation threshold, renewal price — because the difference between the two programs is entirely in those fields, not in their prices.';

/* ⚠️ `create or replace function` re-grants EXECUTE to PUBLIC. Phase 2 is
   server-only: revoked from anon and authenticated, granted to service_role. */
revoke execute on function public.affiliate_dashboard(uuid) from public, anon, authenticated;
grant  execute on function public.affiliate_dashboard(uuid) to service_role;
