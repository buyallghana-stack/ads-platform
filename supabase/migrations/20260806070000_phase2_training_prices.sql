-- ============================================================================
-- Migration 118 — the two training programs, at two distinct fixed prices,
--                 with every other figure set
--
-- Operator, 2026-08-06: *"the pricing for the beginner and the professional
-- course is not in range but a specific price. use two distinct price for the
-- two and also set the other figures."*
--
-- ---------------------------------------------------------------------------
-- ON "NOT IN RANGE" — IT NEVER WAS
--
-- Price BANDS are a Phase 1 concept. A plan there runs from its own price to
-- one pesewa under the next plan's, because what somebody pays inside the range
-- decides what an ad is worth to them.
--
-- A Phase 2 product has ONE price. `products` carries `price_minor` and an
-- optional `sale_price_minor`; there is no band column in the affiliate schema
-- at all, and `product_price_minor()` returns a single figure. So a training
-- program has always been a fixed price and the two below are simply distinct.
-- Nothing had to change for that to be true — this migration sets values.
--
-- ---------------------------------------------------------------------------
-- BOTH PRODUCTS ARE CREATED AS `draft`
--
-- Deliberate. A published training program is buyable, and buying one creates
-- an affiliate account — with no sections and no lessons in it yet, the
-- activation threshold would be measured against an empty curriculum. They go
-- on sale when the Owner has uploaded the content and publishes them.
--
-- EVERY FIGURE HERE IS EDITABLE FROM THE ADMIN. None is a constant in code.
-- ============================================================================

do $$
declare
  v_admin       uuid;
  v_beginner    uuid;
  v_professional uuid;
begin
  select user_id into v_admin
    from public.user_roles where role = 'super_admin' limit 1;

  if v_admin is null then
    raise exception 'No super admin to own the training products';
  end if;

  -- ---------------------------------------------------------------------
  -- Beginner — GHS 150. One commission level: their own sales.
  -- ---------------------------------------------------------------------
  insert into public.products
    (kind, purpose, title, slug, description, price_minor, content_language,
     min_affiliate_tier, status, created_by)
  values
    ('course', 'training_program',
     'Affiliate Training — Beginner',
     'affiliate-training-beginner',
     'Learn to promote SidePerks products and earn commission on your own sales.',
     15000, 'en', 'beginner', 'draft', v_admin)
  on conflict (slug) do update set price_minor = excluded.price_minor
  returning id into v_beginner;

  insert into public.training_programs
    (product_id, level, commission_depth,
     activation_threshold_percent, lesson_pass_percent, quiz_required,
     validity_days, grace_days, renewal_price_minor, certificate_enabled)
  values
    (v_beginner, 'beginner', 1,
     50,      -- half the course completed before they may promote (B9)
     90,      -- a lesson counts at 90% watched (B10)
     true,    -- and its quiz passed (B10)
     365,     -- valid one year from purchase (B11, B11a)
     5,       -- then five days of grace (B11e)
     10000,   -- renewal GHS 100, discounted against GHS 150 (B11b)
     true)
  on conflict (product_id) do update set
    commission_depth             = excluded.commission_depth,
    activation_threshold_percent = excluded.activation_threshold_percent,
    lesson_pass_percent          = excluded.lesson_pass_percent,
    quiz_required                = excluded.quiz_required,
    validity_days                = excluded.validity_days,
    grace_days                   = excluded.grace_days,
    renewal_price_minor          = excluded.renewal_price_minor;

  -- ---------------------------------------------------------------------
  -- Professional — GHS 400. Two levels: own sales, plus an override on the
  -- sales of affiliates they recruited.
  -- ---------------------------------------------------------------------
  insert into public.products
    (kind, purpose, title, slug, description, price_minor, content_language,
     min_affiliate_tier, status, created_by)
  values
    ('course', 'training_program',
     'Affiliate Training — Professional',
     'affiliate-training-professional',
     'Everything in Beginner, plus an override on the sales of affiliates you bring in.',
     40000, 'en', 'beginner', 'draft', v_admin)
  on conflict (slug) do update set price_minor = excluded.price_minor
  returning id into v_professional;

  insert into public.training_programs
    (product_id, level, commission_depth,
     activation_threshold_percent, lesson_pass_percent, quiz_required,
     validity_days, grace_days, renewal_price_minor, certificate_enabled)
  values
    (v_professional, 'professional', 2,
     50, 90, true, 365, 5,
     25000,   -- renewal GHS 250, discounted against GHS 400 (B11b)
     true)
  on conflict (product_id) do update set
    commission_depth             = excluded.commission_depth,
    activation_threshold_percent = excluded.activation_threshold_percent,
    lesson_pass_percent          = excluded.lesson_pass_percent,
    quiz_required                = excluded.quiz_required,
    validity_days                = excluded.validity_days,
    grace_days                   = excluded.grace_days,
    renewal_price_minor          = excluded.renewal_price_minor;

  -- ---------------------------------------------------------------------
  -- What selling a training program pays
  -- ---------------------------------------------------------------------
  --
  -- 20% and 5%, DELIBERATELY BELOW the 30%/10% default for vendor products.
  --
  -- This costs the Owner nothing — he sets both numbers — and it does two
  -- things at once. Commercially it points affiliate effort at the vendor
  -- catalogue, which repeats and grows, rather than at a one-time entry fee.
  -- And it is the most direct available answer to the regulatory concern in
  -- brief §4.6: the programme's own economics reward SELLING more than
  -- RECRUITING. If these rates were ever set above the product rates, that
  -- answer disappears — which is what `affiliate_recruitment_share()` and the
  -- per-affiliate promotion report exist to keep visible.
  insert into public.affiliate_programs
    (product_id, l1_rate_value, l2_rate_value, attribution_window_hours, hold_days)
  values
    (v_beginner,     20, 5, 720, 0),
    (v_professional, 20, 5, 720, 0)
  on conflict (product_id) do update set
    l1_rate_value = excluded.l1_rate_value,
    l2_rate_value = excluded.l2_rate_value;
end $$;


-- ---------------------------------------------------------------------------
-- The figures that are not attached to a single product
-- ---------------------------------------------------------------------------

insert into public.app_config (key, value, description, value_type, min_value, max_value)
values
  ('affiliate_default_l1_percent', '30',
   'Level-one commission suggested for a NEW product, as a percentage of what the buyer paid. Every product stores its own rate; this is only the starting value the admin form offers.',
   'decimal', 0, 100),

  ('affiliate_default_l2_percent', '10',
   'Level-two override suggested for a NEW product. Paid out of what remains of the sale after level one, so the two together can never exceed it.',
   'decimal', 0, 100),

  ('commission_payout_minimum_minor', '5000',
   'Least an affiliate may withdraw from their COMMISSION balance, in pesewas. Separate from the points redemption minimum: commission is already in cedis and points go through a peg (D26).',
   'int', 0, 100000000),

  ('affiliate_payouts_enabled', 'false',
   'Whether commission may be withdrawn at all. Off by default and independent of the points redemption switch, so one business can be opened without committing the other (H45).',
   'bool', null, null)
on conflict (key) do nothing;
