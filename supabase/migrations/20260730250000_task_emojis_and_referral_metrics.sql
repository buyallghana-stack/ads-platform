-- ============================================================================
-- Migration 080 — emoji icons, and two corrections to the referral metrics
--
-- Three operator changes, 2026-07-30:
--
-- 1. EMOJI INSTEAD OF ICON NAMES. The editor offered a dozen Lucide names,
--    which meant the operator could only describe a task with something I had
--    thought of in advance — and "Target" is a poor stand-in for an idea like
--    "invite your friends". An emoji is picked from the keyboard everybody
--    already has, needs no build step to add a new one, and renders the same
--    on the phones this audience uses. The column keeps its name; only what
--    it holds changes, and every existing row is migrated below so no task is
--    left displaying the word "Target".
--
-- 2. `referrals_activated` NOW COUNTS SURVEYS TOO. It only looked for
--    `ad_view`, so somebody whose invitee joined and answered three surveys
--    was told they had activated nobody. The point of the metric is that the
--    invitee did something real, and a survey is more work than a video, not
--    less. Its label changes with it — "watched an ad" was about to become a
--    lie on the screen.
--
-- 3. NEW METRIC `referrals_purchased` — invitees who bought a plan, counted
--    ONCE EACH however many plans they buy. The operator was explicit: twenty
--    purchased plans means twenty referred people, not twenty purchases by
--    one. So it is `count(distinct referee)`, and stacking four plans still
--    counts as one.
--
-- Both referral metrics keep the property that made them safe: they measure
-- what the INVITEE did, never how many accounts exist. Counting signups would
-- pay somebody for creating accounts.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- Emoji
-- ---------------------------------------------------------------------------
--
-- Length rather than a character-class check: an emoji can be several code
-- points joined by zero-width joiners (👨‍👩‍👧 is five), and a regex tight enough
-- to be meaningful would reject the ones people actually use. Twelve
-- characters holds any single emoji including skin tone and ZWJ sequences,
-- and the screen renders whatever is there.

alter table public.tasks
  alter column icon set default '🎯';

alter table public.tasks
  add constraint tasks_icon_length
    check (char_length(trim(icon)) between 1 and 12);

comment on column public.tasks.icon is
  'An emoji, shown beside the task. Free text so the operator is never limited to a set somebody chose in advance; length-checked rather than pattern-checked because emoji are multi-code-point.';

-- Every seeded task, off the Lucide names and onto something a person picked.
update public.tasks set icon = '🎉' where code = 'newbie';
update public.tasks set icon = '📸' where code = 'profile_photo';
update public.tasks set icon = '▶️'  where code = 'first_ads';
update public.tasks set icon = '🍿' where code = 'hundred_ads';
update public.tasks set icon = '🗳️'  where code = 'first_survey';
update public.tasks set icon = '🔐' where code = 'withdrawal_pin';
update public.tasks set icon = '🛡️'  where code = 'two_factor';
update public.tasks set icon = '💎' where code = 'first_plan';
update public.tasks set icon = '🪙' where code = 'five_thousand';
update public.tasks set icon = '🤝' where code = 'three_referrals';
update public.tasks set icon = '💸' where code = 'first_withdrawal';
update public.tasks set icon = '🎰' where code = 'play_five_games';

-- Anything not covered above (a task the operator created before this ran)
-- gets the new default rather than being left showing a component name.
update public.tasks
   set icon = '🎯'
 where icon ~ '^[A-Za-z]+$';


-- ---------------------------------------------------------------------------
-- The metric function, restated
-- ---------------------------------------------------------------------------
--
-- Restated whole rather than patched, because it is a single CASE and the
-- point of that design is that there is exactly one definition of every
-- measurable thing. Only the two referral branches differ from migration 078.

create or replace function public.user_task_metric(
  p_user_id uuid,
  p_metric  public.task_metric
)
returns bigint
language plpgsql
stable
set search_path = ''
as $$
declare
  v bigint;
begin
  case p_metric

    when 'account_created' then
      select count(*) into v from public.profiles p where p.id = p_user_id;

    when 'plans_purchased' then
      select count(*) into v from public.subscription_payments s
       where s.user_id = p_user_id and s.status = 'confirmed';

    when 'ads_watched' then
      select count(*) into v from public.points_ledger l
       where l.user_id = p_user_id and l.entry_type = 'ad_view';

    when 'surveys_completed' then
      select count(*) into v from public.points_ledger l
       where l.user_id = p_user_id and l.entry_type = 'survey';

    when 'points_earned' then
      select coalesce(b.lifetime_earned, 0) into v
        from public.user_balances b where b.user_id = p_user_id;

    when 'referrals_activated' then
      /* Invitees who have EARNED something — a survey counts as much as a
         video, and is more work. Still measures what the invitee did, never
         how many accounts exist. */
      select count(*) into v
        from public.profiles r
       where r.referred_by = p_user_id
         and r.deleted_at is null
         and exists (
           select 1 from public.points_ledger l
            where l.user_id = r.id
              and l.entry_type in ('ad_view', 'survey')
         );

    when 'referrals_purchased' then
      /* Invitees who bought a plan, counted ONCE EACH. Twenty purchased
         plans means twenty referred people — somebody stacking four plans is
         still one referral, which is why this counts profiles and not
         payments. */
      select count(*) into v
        from public.profiles r
       where r.referred_by = p_user_id
         and r.deleted_at is null
         and exists (
           select 1 from public.subscription_payments s
            where s.user_id = r.id and s.status = 'confirmed'
         );

    when 'games_played' then
      select count(*) into v from public.game_plays g where g.user_id = p_user_id;

    when 'gift_codes_redeemed' then
      select count(*) into v from public.gift_code_redemptions r where r.user_id = p_user_id;

    when 'withdrawals_made' then
      select count(*) into v from public.redemptions d
       where d.user_id = p_user_id and d.status = 'paid';

    when 'has_2fa' then
      select count(*) into v from public.user_security s
       where s.user_id = p_user_id and s.totp_confirmed_at is not null;

    when 'has_avatar' then
      select count(*) into v from public.profiles p
       where p.id = p_user_id and p.avatar_path is not null;

    when 'has_withdrawal_pin' then
      select count(*) into v from public.user_security s
       where s.user_id = p_user_id and s.pin_hash is not null;

    else
      v := 0;
  end case;

  return coalesce(v, 0);
end;
$$;


-- The wording on the existing referral task, now that surveys count.
update public.tasks
   set description = 'Invite 3 people who go on to watch an ad or take a survey. Sharing your code is the fastest way to earn here.'
 where code = 'three_referrals';

-- A task on the new metric. Nobody qualifies yet, so it adds no immediate
-- liability — unlike most retroactive tasks, this one starts everybody at zero
-- because no referral has bought a plan.
insert into public.tasks
  (code, name, description, metric, target, reward_points, icon, sort_order)
values
  ('referrals_who_paid', 'Talent scout',
   'Invite 5 people who go on to buy a plan. Each person counts once, however many plans they buy.',
   'referrals_purchased', 5, 5000, '🏆', 105)
on conflict (code) do nothing;
