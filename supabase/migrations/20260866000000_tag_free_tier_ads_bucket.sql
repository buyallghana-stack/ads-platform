-- ============================================================================
-- Migration 218 — tag all ads to plan buckets & enforce plan-holding matching
--
-- 1. Tags any untagged ads to the 'free' tier bucket.
-- 2. Updates `eligible_ad_ids` so that in exclusive bucket mode
--    (`ad_targeting_includes_lower_tiers = false`), a user only sees ads
--    explicitly tagged to the plans they currently hold.
-- ============================================================================

-- 1. Ensure all ads are tagged
INSERT INTO public.ad_tiers (ad_id, tier_id)
SELECT a.id, t.id
FROM public.ads a
CROSS JOIN public.tiers t
WHERE t.slug = 'free'
  AND NOT EXISTS (SELECT 1 FROM public.ad_tiers atg WHERE atg.ad_id = a.id)
ON CONFLICT (ad_id, tier_id) DO NOTHING;

-- 2. eligible_ad_ids — strictly match held plan buckets
CREATE OR REPLACE FUNCTION public.eligible_ad_ids(p_user_id uuid)
RETURNS TABLE (ad_id uuid)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
declare
  v_inclusive boolean := coalesce(public.config_bool('ad_targeting_includes_lower_tiers'), false);
  v_tier_ids  uuid[];
  v_rank      int;
begin
  select array_agg(t.tier_id), max(t.sort_order)
    into v_tier_ids, v_rank
    from public.user_target_tiers(p_user_id) t;

  return query
  select a.id
    from public.ads a
   where a.status = 'active'
     and (a.starts_at is null or a.starts_at <= now())
     and (a.ends_at   is null or a.ends_at   >  now())
     and (a.max_completions is null or a.completions_count < a.max_completions)
     and (
       case
         when v_inclusive then
           coalesce((
             select min(t2.sort_order)
             from public.ad_tiers x
             join public.tiers t2 on t2.id = x.tier_id
             where x.ad_id = a.id
           ), 0) <= coalesce(v_rank, 0)
         else
           exists (
             select 1 from public.ad_tiers x
             where x.ad_id = a.id and x.tier_id = any (v_tier_ids)
           )
       end
     );
end;
$$;

revoke execute on function public.eligible_ad_ids(uuid) from public, anon;
grant execute on function public.eligible_ad_ids(uuid) to authenticated, service_role;
