-- ---------------------------------------------------------------------------
-- The draw overflowed an integer before it ever became a roll.
--
-- `get_byte(...) * 16777216 + ...` is INTEGER arithmetic in Postgres, and four
-- bytes assembled that way reach 4,294,967,295 against an int ceiling of
-- 2,147,483,647. The `::numeric` cast sat on the outside of the expression, so
-- it applied to a result that had already failed: "integer out of range", on
-- roughly half of all plays, depending on the first byte.
--
-- Caught by `tests/affiliate/play.test.ts` on its first run, which is the
-- argument for having written it: nothing about reading the expression makes
-- the overflow visible, and the game had shipped behind a switch that nobody
-- had turned on yet.
--
-- Also: ONE call to `gen_random_bytes`, not four. The original asked for four
-- separate 4-byte values and used one byte of each, which is not wrong but
-- reads as if the four bytes came from one draw when they did not.
-- ---------------------------------------------------------------------------

create or replace function public.play_affiliate_game(
  p_user_id uuid,
  p_game    public.affiliate_game_kind
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status jsonb;
  v_aff    uuid;
  v_week   date := public.affiliate_week_start();
  v_total  int;
  v_bytes  bytea;
  v_draw   numeric;
  v_roll   numeric;
  v_prize  public.affiliate_game_prizes;
  v_acc    numeric := 0;
begin
  if not coalesce(public.config_bool('affiliate_games_enabled'), false) then
    raise exception 'The games are not open yet' using errcode = 'check_violation';
  end if;

  select id into v_aff from public.affiliate_accounts where user_id = p_user_id;
  if v_aff is null then
    raise exception 'You are not an affiliate' using errcode = 'check_violation';
  end if;

  v_status := public.affiliate_game_status(p_user_id);
  if (v_status->>'left')::int <= 0 then
    raise exception 'No plays left this week' using errcode = 'check_violation';
  end if;

  select coalesce(sum(weight), 0) into v_total
    from public.affiliate_game_prizes
   where game = p_game and is_active;

  if v_total <= 0 then
    raise exception 'This game has no prizes set up' using errcode = 'check_violation';
  end if;

  /* `gen_random_bytes`, not `random()`: Postgres's PRNG is seeded and
     deterministic, and this decides money. Same rule as gift codes.

     Every term is numeric BEFORE it is added, which is the whole fix. */
  v_bytes := extensions.gen_random_bytes(4);
  v_draw  := get_byte(v_bytes, 0)::numeric * 16777216
           + get_byte(v_bytes, 1)::numeric * 65536
           + get_byte(v_bytes, 2)::numeric * 256
           + get_byte(v_bytes, 3)::numeric;
  v_roll  := v_draw / 4294967296::numeric * v_total;

  for v_prize in
    select * from public.affiliate_game_prizes
     where game = p_game and is_active
     order by slot
  loop
    v_acc := v_acc + v_prize.weight;
    exit when v_roll < v_acc;
  end loop;

  insert into public.affiliate_game_plays
    (user_id, affiliate_id, game, prize_id, slot, amount_minor, extra_plays_awarded,
     roll, weight_total, week_start)
  values
    (p_user_id, v_aff, p_game, v_prize.id, v_prize.slot, v_prize.amount_minor,
     v_prize.extra_plays, v_roll, v_total, v_week);

  if v_prize.amount_minor > 0 then
    insert into public.commission_ledger
      (affiliate_id, entry_type, amount_minor, status, reason, idempotency_key)
    values
      (v_aff, 'adjustment', v_prize.amount_minor, 'cleared',
       'Game prize: ' || v_prize.label,
       'affiliate-game-' || gen_random_uuid()::text);
  end if;

  return jsonb_build_object(
    'slot',         v_prize.slot,
    'label',        v_prize.label,
    'amount_minor', v_prize.amount_minor,
    'extra_plays',  v_prize.extra_plays,
    'status',       public.affiliate_game_status(p_user_id)
  );
end;
$$;

revoke execute on function public.play_affiliate_game(uuid, public.affiliate_game_kind)
  from public, anon, authenticated;
grant execute on function public.play_affiliate_game(uuid, public.affiliate_game_kind)
  to service_role;
