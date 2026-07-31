-- ============================================================================
-- Migration 093 — a paid link click is 'correct', not 'credited'
--
-- 090 wrote `case when v_result.outcome = 'credited' then …` when the enum
-- `ad_answer_outcome` has no such label. Postgres casts the literal to the
-- enum to make the comparison, and an unknown label there is an ERROR, not a
-- false — so the exception was raised on exactly the path that had just
-- credited somebody, and the whole statement rolled back. A link ad could not
-- pay at all, and the failure looked like "something went wrong" rather than
-- like a typo.
--
-- WHY IT SURVIVED REVIEW AND WAS CAUGHT BY A TEST: every refusal path
-- ('too_fast', 'already_completed', 'earning_blocked') compares to a label
-- that DOES exist, so the function is fine in every case except the one that
-- matters. A test that only proved the refusals would have passed too.
--
-- The paid outcome is `correct` because a link ad is credited by the same
-- `submit_ad_answers` that grades a video, and 'correct' is what that function
-- returns when it pays. Sharing the money path means sharing its vocabulary.
-- ============================================================================

create or replace function public.record_ad_link_click(p_user_id uuid, p_ad_id uuid)
returns public.ad_answer_result
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ad     public.ads;
  v_result public.ad_answer_result;
begin
  select * into v_ad from public.ads where id = p_ad_id;
  if not found or v_ad.format <> 'link' then
    raise exception 'Not a link ad' using errcode = 'check_violation';
  end if;

  /*
    THE PAYMENT IS `submit_ad_answers`, unchanged and unbypassed. It decides
    whether the dwell time has elapsed, whether the daily caps allow it,
    whether earning is paused, whether this person has already been paid for
    this ad, and it writes the ledger row and the counters.
  */
  v_result := public.submit_ad_answers(p_user_id, p_ad_id, '[]'::jsonb);

  /*
    The visit is recorded whatever the answer, because it happened — somebody
    who clicks through a second time, or too fast, or after the daily cap, has
    still been delivered to the advertiser. `on conflict do nothing` keeps it
    at one row per person, and only a paying click carries the points.
  */
  insert into public.ad_link_clicks (ad_id, user_id, points_awarded)
  values (p_ad_id, p_user_id,
          case when v_result.outcome = 'correct' then v_result.points_awarded else 0 end)
  on conflict (ad_id, user_id) do update
    set points_awarded = greatest(public.ad_link_clicks.points_awarded, excluded.points_awarded);

  return v_result;
end;
$$;

comment on function public.record_ad_link_click(uuid, uuid) is
  'Records a click through to the advertiser and pays for it through submit_ad_answers — the same function that pays for a video, so every cap, cooldown and double-credit guard applies unchanged.';

-- Restated, not assumed: this function moves points and must stay unreachable
-- from a browser token.
revoke execute on function public.record_ad_link_click(uuid, uuid)
  from public, anon, authenticated;
