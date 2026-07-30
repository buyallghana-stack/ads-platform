-- ============================================================================
-- Migration 072 — editing the weekly play allowance per plan
--
-- `weekly_game_plays` lives on `tiers`, and `admin_save_plan` does not name
-- that column, so the existing plan editor leaves it alone — which is the
-- behaviour we want, but it also means nothing can change it. This is the one
-- function that can, and it is deliberately narrow: it sets that single column
-- and touches nothing else on a row where every other field is priced money.
--
-- It belongs to the games screen rather than the plans screen because an
-- operator balancing a game economy is thinking about plays and RTP together,
-- not about billing periods.
-- ============================================================================

create or replace function public.admin_set_tier_game_plays(
  p_admin_id uuid,
  p_tier_id  uuid,
  p_plays    integer
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plays int;
begin
  perform public.assert_admin(p_admin_id);

  if p_plays is null or p_plays < 0 or p_plays > 100 then
    raise exception 'Weekly plays must be between 0 and 100'
      using errcode = 'check_violation';
  end if;

  update public.tiers
     set weekly_game_plays = p_plays
   where id = p_tier_id
  returning weekly_game_plays into v_plays;

  if not found then
    raise exception 'No such plan' using errcode = 'check_violation';
  end if;

  return v_plays;
end;
$$;

revoke execute on function public.admin_set_tier_game_plays(uuid, uuid, integer)
  from public, anon, authenticated;


-- The games screen needs the plans with their allowance, and `tiers` has no
-- admin-facing read that includes the new column.
create or replace function public.admin_list_tier_game_plays(p_admin_id uuid)
returns table (
  id                uuid,
  slug              text,
  name              text,
  price_minor       bigint,
  weekly_game_plays integer,
  is_default        boolean,
  is_active         boolean
)
language plpgsql
security definer
stable
set search_path = ''
as $$
begin
  perform public.assert_admin(p_admin_id);

  return query
  select t.id, t.slug, t.name, t.price_minor, t.weekly_game_plays, t.is_default, t.is_active
    from public.tiers t
   order by t.sort_order;
end;
$$;

revoke execute on function public.admin_list_tier_game_plays(uuid)
  from public, anon, authenticated;
