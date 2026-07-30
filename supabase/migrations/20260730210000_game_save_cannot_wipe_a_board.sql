-- ============================================================================
-- Migration 076 — a prize-table save can no longer wipe the other game
--
-- WHAT HAPPENED, in production, within minutes of the games going live. The
-- operator opened /admin/games, switched from the mystery box to the wheel,
-- and saved. Every one of the wheel's twelve prizes was deactivated and the
-- wheel started returning 404. No data was lost — only `is_active` flipped —
-- but the game was gone.
--
-- The cause was in the browser: the editor's `useState(prizes)` initialises
-- ONCE, and a tab switch is a client-side navigation that keeps the same
-- component instance, so the form still held the BOX's rows while its `game`
-- prop had become the wheel. It posted box ids under `p_game = 'spin_wheel'`.
--
-- What this function then did with that payload is the part that belongs in
-- the database. The UPDATE is scoped `where id = v_id and game = p_game`, so
-- every row matched nothing and quietly did nothing — and then the tidy-up
-- pass, which deactivates anything the operator removed from the board,
-- deactivated ALL TWELVE, because not one of them was in the id list.
--
-- The UI is fixed by remounting the editor per game. These two guards exist
-- because that class of mistake must not be able to empty a game again,
-- whatever a future screen or script sends:
--
--   1. An id that does not belong to this game is a REFUSAL, not a no-op.
--      A payload that names rows from somewhere else is confused about what
--      it is editing, and the safe response to confusion on a money screen is
--      to stop.
--   2. A save may not leave a game with nothing active. Every outcome pays
--      something (operator rule 4); a board with no outcomes at all pays
--      nothing at all, which is the same promise broken from the other end.
--
-- Both raise in operator language, because `saveGamePrizes` surfaces the
-- database's message verbatim.
-- ============================================================================

create or replace function public.admin_save_game_prizes(
  p_admin_id uuid,
  p_game     public.game_kind,
  p_prizes   jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row     jsonb;
  v_count   int := 0;
  v_ids     uuid[] := '{}';
  v_id      uuid;
  v_owner   public.game_kind;
  v_active  int;
begin
  perform public.assert_admin(p_admin_id);

  if jsonb_typeof(p_prizes) <> 'array' or jsonb_array_length(p_prizes) = 0 then
    raise exception 'A game needs at least one prize' using errcode = 'check_violation';
  end if;

  for v_row in select * from jsonb_array_elements(p_prizes) loop
    v_id := nullif(v_row->>'id', '')::uuid;

    if v_id is null then
      insert into public.game_prizes
        (game, slot, label, points, extra_plays, weight, colour,
         daily_cap, weekly_cap, is_active)
      values
        (p_game,
         (v_row->>'slot')::int,
         trim(v_row->>'label'),
         coalesce((v_row->>'points')::bigint, 0),
         coalesce((v_row->>'extra_plays')::int, 0),
         coalesce((v_row->>'weight')::int, 1),
         coalesce(v_row->>'colour', '#2563eb'),
         coalesce((v_row->>'daily_cap')::int, 0),
         coalesce((v_row->>'weekly_cap')::int, 0),
         coalesce((v_row->>'is_active')::boolean, true))
      returning id into v_id;
    else
      /* GUARD 1. Before touching anything, establish that this row is ours.
         The old code let a foreign id fall through as an UPDATE that matched
         no rows, which is what turned a mixed-up payload into a wiped board. */
      select game into v_owner from public.game_prizes where id = v_id;

      if v_owner is null then
        raise exception 'That prize no longer exists — reload the page and try again'
          using errcode = 'check_violation';
      end if;

      if v_owner <> p_game then
        raise exception 'These prizes belong to another game — reload the page and try again'
          using errcode = 'check_violation';
      end if;

      update public.game_prizes set
        slot        = (v_row->>'slot')::int,
        label       = trim(v_row->>'label'),
        points      = coalesce((v_row->>'points')::bigint, 0),
        extra_plays = coalesce((v_row->>'extra_plays')::int, 0),
        weight      = coalesce((v_row->>'weight')::int, 1),
        colour      = coalesce(v_row->>'colour', '#2563eb'),
        daily_cap   = coalesce((v_row->>'daily_cap')::int, 0),
        weekly_cap  = coalesce((v_row->>'weekly_cap')::int, 0),
        is_active   = coalesce((v_row->>'is_active')::boolean, true)
      where id = v_id and game = p_game;
    end if;

    v_ids := v_ids || v_id;
    v_count := v_count + 1;
  end loop;

  /*
    Anything the operator removed from the board is DEACTIVATED, never
    deleted: `game_plays.prize_id` is ON DELETE RESTRICT because the record of
    what somebody won must outlive a change of mind about the prize table.
  */
  update public.game_prizes
     set is_active = false
   where game = p_game and not (id = any(v_ids));

  /* GUARD 2. A game with nothing active is a game that 404s. Checked after
     the writes and before the commit, so the whole save rolls back rather
     than leaving a board half-emptied. */
  select count(*) into v_active
    from public.game_prizes where game = p_game and is_active;

  if v_active = 0 then
    raise exception 'That would leave the game with no prizes at all'
      using errcode = 'check_violation';
  end if;

  return v_count;
end;
$$;

revoke execute on function public.admin_save_game_prizes(uuid, public.game_kind, jsonb)
  from public, anon, authenticated;
