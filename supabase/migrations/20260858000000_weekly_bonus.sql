-- =============================================================================
-- Migration: 20260858000000_weekly_bonus
-- Description: Implement the Weekly Bonus system where users earn recurring
--              weekly rewards based on the count of active referred users (L1 + L2)
--              holding paid subscription plans.
-- =============================================================================

-- =============================================================================
-- 1. Type Modifications
-- =============================================================================
-- Add 'weekly_bonus' to ledger entry types if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_enum e ON t.oid = e.enumtypid
    WHERE t.typname = 'ledger_entry_type' AND e.enumlabel = 'weekly_bonus'
  ) THEN
    ALTER TYPE public.ledger_entry_type ADD VALUE 'weekly_bonus';
  END IF;
END $$;

-- =============================================================================
-- 2. Tables
-- =============================================================================

-- Campaign tiers for weekly bonuses
CREATE TABLE IF NOT EXISTS public.weekly_bonus_campaigns (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 100),
  description     text CHECK (description IS NULL OR length(trim(description)) <= 500),
  min_referrals   int NOT NULL CHECK (min_referrals >= 1),
  max_referrals   int CHECK (max_referrals IS NULL OR max_referrals >= min_referrals),
  reward_minor    bigint NOT NULL CHECK (reward_minor > 0),
  is_active       boolean NOT NULL DEFAULT true,
  sort_order      int NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.weekly_bonus_campaigns IS 'Admin-managed weekly bonus tiers for users with active referrals.';

-- User enrollments into the weekly bonus system
CREATE TABLE IF NOT EXISTS public.weekly_bonus_enrollments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  enrolled_at     timestamptz NOT NULL DEFAULT now(),
  is_active       boolean NOT NULL DEFAULT true
);

COMMENT ON TABLE public.weekly_bonus_enrollments IS 'Users opted into the weekly bonus system. Unique on user_id ensures one active enrollment at a time.';

-- Records of claimed weekly bonuses
CREATE TABLE IF NOT EXISTS public.weekly_bonus_claims (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                   uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  campaign_id               uuid NOT NULL REFERENCES public.weekly_bonus_campaigns(id) ON DELETE RESTRICT,
  week_start                date NOT NULL,
  active_referrals_at_claim int NOT NULL,
  reward_minor              bigint NOT NULL CHECK (reward_minor > 0),
  claimed_at                timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, week_start)
);

COMMENT ON TABLE public.weekly_bonus_claims IS 'Weekly bonus claims ensuring one claim per user per completed week.';

-- =============================================================================
-- 3. Indexes & Triggers
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_weekly_bonus_claims_user_id ON public.weekly_bonus_claims(user_id);
CREATE INDEX IF NOT EXISTS idx_weekly_bonus_claims_campaign_id ON public.weekly_bonus_claims(campaign_id);
CREATE INDEX IF NOT EXISTS idx_weekly_bonus_enrollments_user_id ON public.weekly_bonus_enrollments(user_id);
CREATE INDEX IF NOT EXISTS idx_weekly_bonus_campaigns_active ON public.weekly_bonus_campaigns(is_active) WHERE is_active = true;

DROP TRIGGER IF EXISTS tg_weekly_bonus_campaigns_updated_at ON public.weekly_bonus_campaigns;
CREATE TRIGGER tg_weekly_bonus_campaigns_updated_at
  BEFORE UPDATE ON public.weekly_bonus_campaigns
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_updated_at();

-- =============================================================================
-- 4. RLS Policies
-- =============================================================================
ALTER TABLE public.weekly_bonus_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.weekly_bonus_enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.weekly_bonus_claims ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS select_weekly_bonus_campaigns_active ON public.weekly_bonus_campaigns;
CREATE POLICY select_weekly_bonus_campaigns_active ON public.weekly_bonus_campaigns
  FOR SELECT TO authenticated USING (is_active = true);

DROP POLICY IF EXISTS select_weekly_bonus_campaigns_admin ON public.weekly_bonus_campaigns;
CREATE POLICY select_weekly_bonus_campaigns_admin ON public.weekly_bonus_campaigns
  FOR SELECT TO authenticated USING (public.is_admin());

DROP POLICY IF EXISTS select_weekly_bonus_enrollments_own ON public.weekly_bonus_enrollments;
CREATE POLICY select_weekly_bonus_enrollments_own ON public.weekly_bonus_enrollments
  FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS select_weekly_bonus_enrollments_admin ON public.weekly_bonus_enrollments;
CREATE POLICY select_weekly_bonus_enrollments_admin ON public.weekly_bonus_enrollments
  FOR SELECT TO authenticated USING (public.is_admin());

DROP POLICY IF EXISTS select_weekly_bonus_claims_own ON public.weekly_bonus_claims;
CREATE POLICY select_weekly_bonus_claims_own ON public.weekly_bonus_claims
  FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS select_weekly_bonus_claims_admin ON public.weekly_bonus_claims;
CREATE POLICY select_weekly_bonus_claims_admin ON public.weekly_bonus_claims
  FOR SELECT TO authenticated USING (public.is_admin());


-- =============================================================================
-- 5. Functions
-- =============================================================================

-- ---------------------------------------------------------------------------
-- get_active_referral_count
-- ---------------------------------------------------------------------------
-- Counts distinct referred members (L1 and L2) who currently have an active or
-- grace non-free subscription. When a user's subscription expires, they stop
-- counting automatically.
CREATE OR REPLACE FUNCTION public.get_active_referral_count(p_user_id uuid)
RETURNS int
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_count int;
BEGIN
  SELECT count(DISTINCT m.member_id)::int INTO v_count
  FROM public.team_member_ids(p_user_id) m
  JOIN public.user_subscriptions us ON us.user_id = m.member_id
  JOIN public.tiers t ON t.id = us.tier_id
  WHERE us.status IN ('active', 'grace')
    AND t.is_default = false;

  RETURN COALESCE(v_count, 0);
END;
$$;

REVOKE ALL ON FUNCTION public.get_active_referral_count(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_active_referral_count(uuid) TO authenticated, service_role;


-- ---------------------------------------------------------------------------
-- get_weekly_bonus_status
-- ---------------------------------------------------------------------------
-- Self-scoped view for authenticated users: returns active referral count,
-- enrollment status, matched campaign tier, claim eligibility for previous week,
-- and the complete list of active campaigns.
CREATE OR REPLACE FUNCTION public.get_weekly_bonus_status()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid;
  v_active_referrals int;
  v_enrollment record;
  v_matched_campaign record;
  v_last_claim_week date;
  v_claimable_week date;
  v_can_claim boolean := false;
  v_campaigns jsonb;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Live active referral count (L1 + L2 with active paid plans)
  v_active_referrals := public.get_active_referral_count(v_user_id);

  -- User enrollment record
  SELECT * INTO v_enrollment
  FROM public.weekly_bonus_enrollments
  WHERE user_id = v_user_id;

  -- Dynamically match the tier corresponding to current active referral count
  SELECT * INTO v_matched_campaign
  FROM public.weekly_bonus_campaigns
  WHERE is_active = true
    AND min_referrals <= v_active_referrals
    AND (max_referrals IS NULL OR max_referrals >= v_active_referrals)
  ORDER BY min_referrals DESC
  LIMIT 1;

  -- Previous completed week start (the Monday before the current Monday UTC)
  v_claimable_week := (date_trunc('week', now() AT TIME ZONE 'UTC') - interval '7 days')::date;

  -- Check most recent claim
  SELECT week_start INTO v_last_claim_week
  FROM public.weekly_bonus_claims
  WHERE user_id = v_user_id
  ORDER BY week_start DESC
  LIMIT 1;

  -- User can claim if enrolled, qualified for a tier, and hasn't claimed previous completed week yet
  IF v_enrollment.is_active = true AND v_matched_campaign.id IS NOT NULL THEN
    IF v_last_claim_week IS NULL OR v_last_claim_week < v_claimable_week THEN
      v_can_claim := true;
    END IF;
  END IF;

  -- List all active campaigns in order
  SELECT jsonb_agg(jsonb_build_object(
    'id', id,
    'name', name,
    'description', description,
    'min_referrals', min_referrals,
    'max_referrals', max_referrals,
    'reward_minor', reward_minor,
    'is_active', is_active,
    'sort_order', sort_order
  ) ORDER BY sort_order ASC, min_referrals ASC) INTO v_campaigns
  FROM public.weekly_bonus_campaigns
  WHERE is_active = true;

  RETURN jsonb_build_object(
    'active_referrals', v_active_referrals,
    'enrolled', (v_enrollment.is_active IS TRUE),
    'enrollment_id', v_enrollment.id,
    'matched_campaign', CASE WHEN v_matched_campaign.id IS NOT NULL THEN
                          jsonb_build_object(
                            'id', v_matched_campaign.id,
                            'name', v_matched_campaign.name,
                            'description', v_matched_campaign.description,
                            'min_referrals', v_matched_campaign.min_referrals,
                            'max_referrals', v_matched_campaign.max_referrals,
                            'reward_minor', v_matched_campaign.reward_minor,
                            'is_active', v_matched_campaign.is_active,
                            'sort_order', v_matched_campaign.sort_order
                          )
                        ELSE NULL END,
    'can_claim', v_can_claim,
    'claimable_week', v_claimable_week,
    'last_claim_week', v_last_claim_week,
    'campaigns', COALESCE(v_campaigns, '[]'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_weekly_bonus_status() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_weekly_bonus_status() TO authenticated;


-- ---------------------------------------------------------------------------
-- enroll_weekly_bonus
-- ---------------------------------------------------------------------------
-- User manually enters the weekly bonus system. They are automatically assigned
-- to the campaign tier matching their live active referral count.
CREATE OR REPLACE FUNCTION public.enroll_weekly_bonus()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid;
  v_active_referrals int;
  v_enrollment_id uuid;
  v_matched_campaign record;
  v_min_required int;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Check if already actively enrolled
  SELECT id INTO v_enrollment_id
  FROM public.weekly_bonus_enrollments
  WHERE user_id = v_user_id AND is_active = true;

  IF v_enrollment_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'outcome', 'already_enrolled',
      'success', false,
      'error', 'already_enrolled'
    );
  END IF;

  -- Check active referrals count
  v_active_referrals := public.get_active_referral_count(v_user_id);

  -- Lowest active tier minimum
  SELECT min(min_referrals) INTO v_min_required
  FROM public.weekly_bonus_campaigns
  WHERE is_active = true;

  IF v_min_required IS NULL THEN
    RETURN jsonb_build_object(
      'outcome', 'no_campaigns',
      'success', false,
      'error', 'no_campaigns'
    );
  END IF;

  IF v_active_referrals < v_min_required THEN
    RETURN jsonb_build_object(
      'outcome', 'not_qualified',
      'success', false,
      'error', 'not_qualified',
      'current', v_active_referrals,
      'required', v_min_required
    );
  END IF;

  -- Upsert enrollment
  INSERT INTO public.weekly_bonus_enrollments (user_id, is_active, enrolled_at)
  VALUES (v_user_id, true, now())
  ON CONFLICT (user_id) DO UPDATE SET is_active = true, enrolled_at = now()
  RETURNING id INTO v_enrollment_id;

  -- Matched campaign tier
  SELECT * INTO v_matched_campaign
  FROM public.weekly_bonus_campaigns
  WHERE is_active = true
    AND min_referrals <= v_active_referrals
    AND (max_referrals IS NULL OR max_referrals >= v_active_referrals)
  ORDER BY min_referrals DESC
  LIMIT 1;

  RETURN jsonb_build_object(
    'outcome', 'ok',
    'success', true,
    'enrollment_id', v_enrollment_id,
    'matched_campaign', CASE WHEN v_matched_campaign.id IS NOT NULL THEN
                          jsonb_build_object(
                            'id', v_matched_campaign.id,
                            'name', v_matched_campaign.name,
                            'description', v_matched_campaign.description,
                            'min_referrals', v_matched_campaign.min_referrals,
                            'max_referrals', v_matched_campaign.max_referrals,
                            'reward_minor', v_matched_campaign.reward_minor,
                            'sort_order', v_matched_campaign.sort_order
                          )
                        ELSE NULL END
  );
END;
$$;

REVOKE ALL ON FUNCTION public.enroll_weekly_bonus() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enroll_weekly_bonus() TO authenticated;


-- ---------------------------------------------------------------------------
-- unenroll_weekly_bonus
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.unenroll_weekly_bonus()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid;
  v_found boolean;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  UPDATE public.weekly_bonus_enrollments
  SET is_active = false
  WHERE user_id = v_user_id AND is_active = true;

  GET DIAGNOSTICS v_found = ROW_COUNT;

  IF v_found THEN
    RETURN jsonb_build_object('outcome', 'ok', 'success', true);
  ELSE
    RETURN jsonb_build_object('outcome', 'not_enrolled', 'success', false);
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.unenroll_weekly_bonus() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.unenroll_weekly_bonus() TO authenticated;


-- ---------------------------------------------------------------------------
-- claim_weekly_bonus (Service role only — the money path)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_weekly_bonus(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_profile             public.profiles;
  v_enrollment          public.weekly_bonus_enrollments;
  v_active_referrals    int;
  v_matched_campaign    public.weekly_bonus_campaigns;
  v_claimable_week      date;
  v_existing_claim      uuid;
  v_rate                bigint;
  v_points              bigint;
BEGIN
  -- Validate user standing
  SELECT * INTO v_profile FROM public.profiles WHERE id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unknown user' USING errcode = 'check_violation';
  END IF;
  IF v_profile.disabled_at IS NOT NULL THEN
    RETURN jsonb_build_object('outcome', 'account_disabled', 'success', false);
  END IF;

  -- Validate active enrollment
  SELECT * INTO v_enrollment
  FROM public.weekly_bonus_enrollments
  WHERE user_id = p_user_id AND is_active = true;

  IF v_enrollment.id IS NULL THEN
    RETURN jsonb_build_object('outcome', 'not_enrolled', 'success', false);
  END IF;

  -- Re-derive active referral count dynamically at claim moment
  v_active_referrals := public.get_active_referral_count(p_user_id);

  -- Determine qualifying campaign tier based on current active referrals
  SELECT * INTO v_matched_campaign
  FROM public.weekly_bonus_campaigns
  WHERE is_active = true
    AND min_referrals <= v_active_referrals
    AND (max_referrals IS NULL OR max_referrals >= v_active_referrals)
  ORDER BY min_referrals DESC
  LIMIT 1;

  IF v_matched_campaign.id IS NULL THEN
    RETURN jsonb_build_object(
      'outcome', 'not_qualified',
      'success', false,
      'active_referrals', v_active_referrals
    );
  END IF;

  -- Completed previous week start (Monday UTC)
  v_claimable_week := (date_trunc('week', now() AT TIME ZONE 'UTC') - interval '7 days')::date;

  -- Check if already claimed for this week
  SELECT id INTO v_existing_claim
  FROM public.weekly_bonus_claims
  WHERE user_id = p_user_id AND week_start = v_claimable_week;

  IF v_existing_claim IS NOT NULL THEN
    RETURN jsonb_build_object('outcome', 'already_claimed', 'success', false);
  END IF;

  -- Record claim (UNIQUE constraint on user_id, week_start prevents double-claim)
  BEGIN
    INSERT INTO public.weekly_bonus_claims (
      user_id, campaign_id, week_start, active_referrals_at_claim, reward_minor
    ) VALUES (
      p_user_id, v_matched_campaign.id, v_claimable_week, v_active_referrals, v_matched_campaign.reward_minor
    );
  EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('outcome', 'already_claimed', 'success', false);
  END;

  -- Convert reward minor (pesewas) to points using points_per_currency_unit rate
  v_rate := greatest(coalesce(public.config_int('points_per_currency_unit'), 100), 1);
  v_points := (v_matched_campaign.reward_minor * v_rate) / 100;

  -- Credit points to user ledger
  PERFORM public.credit_points(
    p_user_id,
    v_points,
    'weekly_bonus'::public.ledger_entry_type,
    'weekly_bonus_claim',
    v_matched_campaign.id::text,
    jsonb_build_object(
      'week_start', v_claimable_week,
      'campaign_name', v_matched_campaign.name,
      'active_referrals', v_active_referrals,
      'reward_minor', v_matched_campaign.reward_minor
    )
  );

  -- Send payout notification to user
  PERFORM public.create_notification(
    p_user_id,
    'payout'::public.notification_type,
    'Weekly Bonus Claimed',
    v_matched_campaign.name || ' — GHS ' || to_char(v_matched_campaign.reward_minor / 100.0, 'FM999,990.00') || ' bonus added to your balance for ' || v_active_referrals || ' active referrals.',
    jsonb_build_object(
      'campaign_id', v_matched_campaign.id,
      'week_start', v_claimable_week,
      'reward_minor', v_matched_campaign.reward_minor
    )
  );

  RETURN jsonb_build_object(
    'outcome', 'ok',
    'success', true,
    'reward_minor', v_matched_campaign.reward_minor,
    'campaign_name', v_matched_campaign.name,
    'week_start', v_claimable_week
  );
END;
$$;

REVOKE ALL ON FUNCTION public.claim_weekly_bonus(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_weekly_bonus(uuid) TO service_role;


-- ---------------------------------------------------------------------------
-- admin_list_weekly_bonus_campaigns
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_list_weekly_bonus_campaigns(p_admin_id uuid)
RETURNS TABLE (
  id                uuid,
  name              text,
  description       text,
  min_referrals     int,
  max_referrals     int,
  reward_minor      bigint,
  is_active         boolean,
  sort_order        int,
  created_at        timestamptz,
  updated_at        timestamptz,
  enrolled_count    bigint,
  claims_count      bigint,
  total_paid_minor  bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM public.assert_admin(p_admin_id);

  RETURN QUERY
  SELECT
    c.id,
    c.name,
    c.description,
    c.min_referrals,
    c.max_referrals,
    c.reward_minor,
    c.is_active,
    c.sort_order,
    c.created_at,
    c.updated_at,
    (
      SELECT count(*)::bigint
      FROM public.weekly_bonus_enrollments e
      WHERE e.is_active = true
        AND public.get_active_referral_count(e.user_id) >= c.min_referrals
        AND (c.max_referrals IS NULL OR public.get_active_referral_count(e.user_id) <= c.max_referrals)
    ),
    (SELECT count(*)::bigint FROM public.weekly_bonus_claims cl WHERE cl.campaign_id = c.id),
    (SELECT coalesce(sum(cl.reward_minor), 0)::bigint FROM public.weekly_bonus_claims cl WHERE cl.campaign_id = c.id)
  FROM public.weekly_bonus_campaigns c
  ORDER BY c.sort_order ASC, c.min_referrals ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_weekly_bonus_campaigns(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_weekly_bonus_campaigns(uuid) TO service_role;


-- ---------------------------------------------------------------------------
-- admin_save_weekly_bonus_campaign
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_save_weekly_bonus_campaign(
  p_admin_id uuid,
  p_campaign jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_id              uuid := nullif(p_campaign->>'id', '')::uuid;
  v_name            text := trim(COALESCE(p_campaign->>'name', ''));
  v_description     text := nullif(trim(COALESCE(p_campaign->>'description', '')), '');
  v_min_referrals   int := (p_campaign->>'min_referrals')::int;
  v_max_referrals   int := nullif(p_campaign->>'max_referrals', '')::int;
  v_reward_minor    bigint := (p_campaign->>'reward_minor')::bigint;
  v_is_active       boolean := COALESCE((p_campaign->>'is_active')::boolean, true);
  v_sort_order      int := COALESCE((p_campaign->>'sort_order')::int, 0);
  v_overlap         boolean;
BEGIN
  PERFORM public.assert_admin(p_admin_id);

  IF v_name = '' THEN
    RAISE EXCEPTION 'A campaign requires a name' USING errcode = 'check_violation';
  END IF;

  IF v_min_referrals < 1 THEN
    RAISE EXCEPTION 'Minimum referrals must be at least 1' USING errcode = 'check_violation';
  END IF;

  IF v_max_referrals IS NOT NULL AND v_max_referrals < v_min_referrals THEN
    RAISE EXCEPTION 'Maximum referrals cannot be less than minimum referrals' USING errcode = 'check_violation';
  END IF;

  IF v_reward_minor <= 0 THEN
    RAISE EXCEPTION 'Weekly reward must be greater than zero' USING errcode = 'check_violation';
  END IF;

  -- Validate range overlap with other active campaigns
  IF v_is_active THEN
    SELECT EXISTS (
      SELECT 1 FROM public.weekly_bonus_campaigns
      WHERE is_active = true
        AND id IS DISTINCT FROM v_id
        AND (v_min_referrals <= COALESCE(max_referrals, 2147483647))
        AND (min_referrals <= COALESCE(v_max_referrals, 2147483647))
    ) INTO v_overlap;

    IF v_overlap THEN
      RAISE EXCEPTION 'Campaign referral range overlaps with another active campaign' USING errcode = 'check_violation';
    END IF;
  END IF;

  IF v_id IS NULL THEN
    INSERT INTO public.weekly_bonus_campaigns (
      name, description, min_referrals, max_referrals, reward_minor, is_active, sort_order
    ) VALUES (
      v_name, v_description, v_min_referrals, v_max_referrals, v_reward_minor, v_is_active, v_sort_order
    ) RETURNING id INTO v_id;
  ELSE
    UPDATE public.weekly_bonus_campaigns SET
      name          = v_name,
      description   = v_description,
      min_referrals = v_min_referrals,
      max_referrals = v_max_referrals,
      reward_minor  = v_reward_minor,
      is_active     = v_is_active,
      sort_order    = v_sort_order,
      updated_at    = now()
    WHERE id = v_id;
  END IF;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_save_weekly_bonus_campaign(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_save_weekly_bonus_campaign(uuid, jsonb) TO service_role;


-- ---------------------------------------------------------------------------
-- admin_delete_weekly_bonus_campaign
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_delete_weekly_bonus_campaign(
  p_admin_id     uuid,
  p_campaign_id  uuid
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_has_claims boolean;
BEGIN
  PERFORM public.assert_admin(p_admin_id);

  SELECT EXISTS (
    SELECT 1 FROM public.weekly_bonus_claims WHERE campaign_id = p_campaign_id
  ) INTO v_has_claims;

  IF v_has_claims THEN
    UPDATE public.weekly_bonus_campaigns
    SET is_active = false, updated_at = now()
    WHERE id = p_campaign_id;
    RETURN 'archived';
  ELSE
    DELETE FROM public.weekly_bonus_campaigns WHERE id = p_campaign_id;
    RETURN 'deleted';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_delete_weekly_bonus_campaign(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_weekly_bonus_campaign(uuid, uuid) TO service_role;


-- =============================================================================
-- 6. Seed Data (11 tiers from earning structure)
-- =============================================================================

INSERT INTO public.weekly_bonus_campaigns (name, description, min_referrals, max_referrals, reward_minor, sort_order, is_active)
VALUES
  ('Tier 1 (20–50)', '20 to 50 active referrals on paid plans', 20, 50, 5000, 1, true),
  ('Tier 2 (51–80)', '51 to 80 active referrals on paid plans', 51, 80, 7000, 2, true),
  ('Tier 3 (81–100)', '81 to 100 active referrals on paid plans', 81, 100, 9000, 3, true),
  ('Tier 4 (101–150)', '101 to 150 active referrals on paid plans', 101, 150, 12000, 4, true),
  ('Tier 5 (151–200)', '151 to 200 active referrals on paid plans', 151, 200, 15000, 5, true),
  ('Tier 6 (201–300)', '201 to 300 active referrals on paid plans', 201, 300, 17000, 6, true),
  ('Tier 7 (301–400)', '301 to 400 active referrals on paid plans', 301, 400, 19000, 7, true),
  ('Tier 8 (401–500)', '401 to 500 active referrals on paid plans', 401, 500, 22000, 8, true),
  ('Tier 9 (501–800)', '501 to 800 active referrals on paid plans', 501, 800, 30000, 9, true),
  ('Tier 10 (801–1000)', '801 to 1000 active referrals on paid plans', 801, 1000, 40000, 10, true),
  ('Tier 11 (1001+)', '1001 or more active referrals on paid plans', 1001, NULL, 50000, 11, true)
ON CONFLICT DO NOTHING;
