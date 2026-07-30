-- ============================================================================
-- Migration 074 — admin_game_stats returned types that did not match
--
-- Found by the test that asks the function what a table costs: every call
-- raised "structure of query does not match function result type", so the
-- admin games screen would have shown no statistics at all.
--
-- The cause is a Postgres detail worth remembering: `sum()` over a BIGINT
-- column returns NUMERIC, not bigint — the widening is deliberate, because a
-- sum of bigints can overflow one. `points_period` summed
-- `game_plays.points_awarded` (bigint) into a column declared bigint, and
-- plpgsql checks that on the way out rather than coercing it.
--
-- `sum()` over an INTEGER column returns bigint, which is why
-- `extra_plays_won` happened to be fine — the two columns differ only in the
-- type of what they sum. Casting both makes the reason explicit rather than
-- leaving one right by luck.
-- ============================================================================

create or replace function public.admin_game_stats(
  p_admin_id uuid,
  p_game     public.game_kind,
  p_days     integer default 30
)
returns table (
  plays_total      bigint,
  plays_period     bigint,
  points_period    bigint,
  expected_rtp     numeric,
  actual_rtp       numeric,
  players_period   bigint,
  extra_plays_won  bigint
)
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_since timestamptz := now() - make_interval(days => greatest(coalesce(p_days, 30), 1));
  v_total bigint;
begin
  perform public.assert_admin(p_admin_id);

  select coalesce(sum(weight), 0) into v_total
    from public.game_prizes where game = p_game and is_active and weight > 0;

  return query
  select
    (select count(*) from public.game_plays g where g.game = p_game),
    (select count(*) from public.game_plays g where g.game = p_game and g.created_at >= v_since),
    (select coalesce(sum(g.points_awarded), 0)::bigint from public.game_plays g
      where g.game = p_game and g.created_at >= v_since),
    case when v_total = 0 then 0::numeric else
      (select round(coalesce(sum(p.weight::numeric * p.points), 0) / v_total, 2)
         from public.game_prizes p
        where p.game = p_game and p.is_active and p.weight > 0)
    end,
    (select case when count(*) = 0 then 0::numeric
                 else round(coalesce(sum(g.points_awarded), 0)::numeric / count(*), 2) end
       from public.game_plays g where g.game = p_game and g.created_at >= v_since),
    (select count(distinct g.user_id) from public.game_plays g
      where g.game = p_game and g.created_at >= v_since),
    (select coalesce(sum(g.extra_plays_awarded), 0)::bigint from public.game_plays g
      where g.game = p_game and g.created_at >= v_since);
end;
$$;

revoke execute on function public.admin_game_stats(uuid, public.game_kind, integer)
  from public, anon, authenticated;
