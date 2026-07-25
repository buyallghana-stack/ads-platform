-- ============================================================================
-- Migration 044 — the ad pool: tier targeting, and surveys that branch
--
-- Two operator requirements (2026-07-25), both about the pool of ads being
-- something you stock once and leave alone rather than curate daily.
--
-- 1. TIER TARGETING. "all ads need a tier specification… an ad may be
--    configured for one or more tier". So an advertiser's contract can be
--    aimed at particular plans and the serving query respects it, with no
--    daily intervention.
--
-- 2. CONDITIONAL QUESTIONS. "you can't have a survey that asks 'are you a
--    boy?' and later asks 'how do you feel being a girl'". A question can now
--    depend on an earlier answer. Surveys that need no branching carry no
--    rules and every respondent sees the same list — the straight-through
--    case stays the default and costs nothing.
--
-- The branching rules are evaluated in BOTH places on purpose, and the
-- division of labour matters: the player uses them to decide what to show
-- next, the database uses them to decide what it is entitled to REQUIRE and
-- grade. Only the database's answer affects money. A client that skipped a
-- question it should have asked cannot earn by doing so, because the server
-- recomputes visibility from the submitted answers and refuses anything it
-- still expects an answer for.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. Which tiers an ad is for
-- ---------------------------------------------------------------------------
--
-- NO ROWS MEANS EVERYONE. That default is deliberate: the common case is an
-- ad for the whole audience, and making the common case require configuration
-- is how ad pools end up empty for somebody.

create table public.ad_tiers (
  ad_id   uuid not null references public.ads (id)   on delete cascade,
  tier_id uuid not null references public.tiers (id) on delete cascade,
  primary key (ad_id, tier_id)
);

comment on table public.ad_tiers is
  'Which plans an ad is aimed at. No rows for an ad = shown to everyone. See ad_targeting_includes_lower_tiers for how a higher plan inherits.';

create index ad_tiers_tier_idx on public.ad_tiers (tier_id);

alter table public.ad_tiers enable row level security;

create policy "Read ad tiers" on public.ad_tiers for select to authenticated using (true);
create policy "Admins write ad tiers" on public.ad_tiers for all to authenticated
  using (public.is_admin()) with check (public.is_admin());


-- ---------------------------------------------------------------------------
-- 2. Does a higher plan see a lower plan's ads?
-- ---------------------------------------------------------------------------
--
-- Left as a switch because it is a business call with a trap on one side: if
-- targeting is EXACT, buying Gold can shrink the pool a user sees, so paying
-- more gives them less to earn from. Inclusive is therefore the default —
-- a Gold user sees ads aimed at Bronze, Silver and Gold.

insert into public.app_config (key, value, value_type, min_value, max_value, description, is_public)
values (
  'ad_targeting_includes_lower_tiers',
  'true',
  'bool',
  null, null,
  'When true (default) a plan also sees ads targeted at cheaper plans, so upgrading never shrinks somebody''s ad pool. When false, targeting is exact: only users holding one of the ad''s listed tiers see it.',
  false
)
on conflict (key) do nothing;


-- ---------------------------------------------------------------------------
-- 3. The tiers a user counts as, for targeting
-- ---------------------------------------------------------------------------
--
-- NOT resolve_user_tier: that returns a synthetic combined tier when plans
-- stack ("Platinum +3"), which is the right answer for multipliers and the
-- wrong one for targeting — it is not a row anybody can target. Targeting
-- works off the plans actually HELD, falling back to the default tier for
-- someone with none.

create or replace function public.user_target_tiers(p_user_id uuid)
returns table (tier_id uuid, sort_order int)
language sql
stable
security definer
set search_path = ''
as $$
  with held as (
    select t.id, t.sort_order
    from public.user_subscriptions s
    join public.tiers t on t.id = s.tier_id
    where s.user_id = p_user_id
      and s.status in ('active', 'grace')
      and coalesce(s.grace_ends_at, s.current_period_end) > now()
  )
  select id, sort_order from held
  union all
  select t.id, t.sort_order
  from public.tiers t
  where t.is_default and not exists (select 1 from held);
$$;

comment on function public.user_target_tiers(uuid) is
  'The tier rows a user counts as for ad targeting: every plan currently held, or the default tier when they hold none.';

revoke execute on function public.user_target_tiers(uuid) from public, anon;


-- ---------------------------------------------------------------------------
-- 4. Conditional questions
-- ---------------------------------------------------------------------------

create type public.question_condition_mode as enum ('all', 'any');

alter table public.ad_questions
  add column condition_mode public.question_condition_mode not null default 'all';

comment on column public.ad_questions.condition_mode is
  'How this question''s rules combine. all = every rule must pass (default), any = one is enough. Irrelevant when the question has no rules, which is the straight-through case.';

create table public.ad_question_rules (
  id uuid primary key default gen_random_uuid(),

  -- The question this rule GATES: show it only when the rule passes.
  question_id uuid not null references public.ad_questions (id) on delete cascade,

  -- The earlier question whose answer is being tested.
  depends_on_question_id uuid not null references public.ad_questions (id) on delete cascade,

  -- "is" vs "is not".
  negate boolean not null default false,

  -- Exactly one of these. option_id for multiple choice, value_text for a
  -- typed answer (compared case-insensitively and trimmed, like grading).
  option_id  uuid references public.ad_question_options (id) on delete cascade,
  value_text text,

  created_at timestamptz not null default now(),

  constraint ad_question_rules_one_target check (
    (option_id is not null and value_text is null)
    or (option_id is null and value_text is not null)
  ),
  constraint ad_question_rules_no_self check (question_id <> depends_on_question_id)
);

comment on table public.ad_question_rules is
  'Skip logic. A question with no rules is always shown. With rules, it is shown only when they pass, per the question''s condition_mode.';

create index ad_question_rules_question_idx on public.ad_question_rules (question_id);
create index ad_question_rules_depends_idx on public.ad_question_rules (depends_on_question_id);

alter table public.ad_question_rules enable row level security;

-- Admin-only, exactly like ad_questions: a rule names option ids, and the set
-- of options a rule points at is a hint about which answer matters.
create policy "Admins read question rules" on public.ad_question_rules
  for select to authenticated using (public.is_admin());
create policy "Admins write question rules" on public.ad_question_rules
  for all to authenticated using (public.is_admin()) with check (public.is_admin());


-- A rule may only look BACKWARDS. Without this an admin can build a survey
-- that asks question 2 to depend on question 5, which is unanswerable at the
-- moment it is evaluated, or a cycle that is unanswerable at all. Enforced
-- here rather than in the editor because the editor is not the only writer.
create or replace function public.ad_question_rule_is_backward()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_this   record;
  v_depend record;
begin
  select ad_id, position into v_this
    from public.ad_questions where id = new.question_id;
  select ad_id, position into v_depend
    from public.ad_questions where id = new.depends_on_question_id;

  if v_this.ad_id is distinct from v_depend.ad_id then
    raise exception 'A question rule must depend on a question in the same ad'
      using errcode = 'check_violation';
  end if;

  if v_depend.position >= v_this.position then
    raise exception 'A question rule must depend on an EARLIER question (position % depends on %)',
      v_this.position, v_depend.position using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

revoke execute on function public.ad_question_rule_is_backward() from public, anon, authenticated;

create trigger ad_question_rules_backward_only
  before insert or update on public.ad_question_rules
  for each row execute function public.ad_question_rule_is_backward();


-- ---------------------------------------------------------------------------
-- 5. Visibility — the single definition both sides agree on
-- ---------------------------------------------------------------------------
--
-- Returns the questions of an ad that a given set of answers makes visible,
-- evaluated in position order so a chain works: if Q2 is hidden then a rule
-- depending on Q2 cannot pass, and Q4 behind it stays hidden too. Anything
-- else would let a skipped branch drag its follow-ups back into view.

create or replace function public.visible_ad_questions(p_ad_id uuid, p_answers jsonb)
-- Not `position`: reserved in a RETURNS TABLE column list.
returns table (question_id uuid, question_position int)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_q       record;
  v_rule    record;
  v_visible uuid[] := '{}';
  v_pass    boolean;
  v_any     boolean;
  v_all     boolean;
  v_has     boolean;
  v_answer  text;
  v_match   boolean;
begin
  for v_q in
    select q.id, q.position, q.condition_mode
      from public.ad_questions q
     where q.ad_id = p_ad_id
     order by q.position
  loop
    v_has := false;
    v_any := false;
    v_all := true;

    for v_rule in
      select r.depends_on_question_id, r.negate, r.option_id, r.value_text
        from public.ad_question_rules r
       where r.question_id = v_q.id
    loop
      v_has := true;

      -- A rule whose subject was never shown cannot pass. This is what makes
      -- skipping cascade instead of leaking follow-ups back in.
      if not (v_rule.depends_on_question_id = any (v_visible)) then
        v_match := false;
      else
        v_answer := p_answers ->> v_rule.depends_on_question_id::text;
        if v_answer is null then
          v_match := false;
        elsif v_rule.option_id is not null then
          v_match := (v_answer = v_rule.option_id::text);
        else
          v_match := (lower(trim(v_answer)) = lower(trim(v_rule.value_text)));
        end if;
      end if;

      if v_rule.negate then v_match := not v_match; end if;

      v_any := v_any or v_match;
      v_all := v_all and v_match;
    end loop;

    v_pass := case
                when not v_has then true
                when v_q.condition_mode = 'any' then v_any
                else v_all
              end;

    if v_pass then
      v_visible := v_visible || v_q.id;
      question_id       := v_q.id;
      question_position := v_q.position;
      return next;
    end if;
  end loop;
end;
$$;

comment on function public.visible_ad_questions(uuid, jsonb) is
  'The questions of an ad that these answers make visible, in position order. The one definition of skip logic; submit_ad_answers grades exactly this set.';

revoke execute on function public.visible_ad_questions(uuid, jsonb) from public, anon;
