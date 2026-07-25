-- ============================================================================
-- Migration 039 — Two new earning outcomes, and the config a ceiling needs
--
-- Split from migration 040 on purpose: Postgres will not let a transaction add
-- a value to an enum and then use that value. The functions that return these
-- outcomes therefore live in the next migration.
--
-- Why the outcomes are needed
-- ---------------------------
-- submit_ad_answers collapsed three genuinely different refusals into one
-- answer, `daily_cap_reached`, because it matched the message text of whatever
-- credit_points raised:
--
--   * the ad cap   "you have watched your allowance for today"   -> true
--   * a cooldown   "wait 30 seconds"                             -> WRONG
--   * a points cap "you have earned the maximum points today"    -> WRONG
--
-- Telling somebody who has to wait half a minute to come back tomorrow is a
-- straightforward lie, and the moment `ad_cooldown_seconds` is set to anything
-- it becomes a lie the operator is telling at scale. Each refusal now has its
-- own outcome so the screen can say the true thing.
-- ============================================================================

alter type public.ad_answer_outcome add value if not exists 'cooldown_active';
alter type public.ad_answer_outcome add value if not exists 'points_cap_reached';


-- ---------------------------------------------------------------------------
-- reward_pool_ceiling_blocks
-- ---------------------------------------------------------------------------
--
-- `reward_pool_daily_ceiling_points` has always been alert-only, and the alert
-- text says so out loud: "Earning was NOT blocked." That was a deliberate
-- choice — a platform-wide hard stop mid-day is a serious thing to trigger
-- automatically, and an operator who is asleep cannot un-trigger it.
--
-- It is the right default and the wrong ONLY option: an operator who has
-- funded a fixed daily reward budget needs to be able to stop at it rather
-- than read about overspending in the morning. So the behaviour becomes a
-- switch, defaulting to the existing behaviour. Nothing changes until it is
-- turned on.

insert into public.app_config (key, value, value_type, min_value, max_value, description, is_public)
values (
  'reward_pool_ceiling_blocks',
  'false',
  'bool',
  null,
  null,
  'Whether reaching reward_pool_daily_ceiling_points STOPS earning platform-wide for the rest of the UTC day. False (default) only raises a critical alert and lets earning continue — safer, because a hard stop cannot be undone by a sleeping operator. Has no effect while the ceiling is 0.',
  false
)
on conflict (key) do nothing;
