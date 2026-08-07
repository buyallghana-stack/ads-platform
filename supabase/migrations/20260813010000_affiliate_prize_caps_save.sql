-- ---------------------------------------------------------------------------
-- Saving the caps as well as the weights.
--
-- `admin_save_affiliate_prizes` predates `daily_cap` and wrote `weekly_cap`
-- through a `nullif(..., 0)` that turned "no cap" into NULL. Both are plain
-- integers now, 0 meaning no cap, exactly as the ads table has always meant
-- it — so an operator editing the rationing on the big prizes actually
-- changes the draw.
-- ---------------------------------------------------------------------------

create or replace function public.admin_save_affiliate_prizes(
  p_admin_id uuid,
  p_game     public.affiliate_game_kind,
  p_prizes   jsonb
)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row    jsonb;
  v_count  int := 0;
  v_id     uuid;
  v_owner  public.affiliate_game_kind;
  v_active int;
begin
  perform public.assert_admin(p_admin_id);

  if jsonb_typeof(p_prizes) <> 'array' or jsonb_array_length(p_prizes) = 0 then
    raise exception 'A game needs at least one prize' using errcode = 'check_violation';
  end if;

  for v_row in select * from jsonb_array_elements(p_prizes) loop
    v_id := nullif(v_row->>'id', '')::uuid;

    if v_id is null then
      insert into public.affiliate_game_prizes
        (game, slot, label, amount_minor, extra_plays, weight, colour,
         daily_cap, weekly_cap, is_active)
      values
        (p_game,
         (v_row->>'slot')::int,
         trim(v_row->>'label'),
         greatest(coalesce((v_row->>'amount_minor')::bigint, 0), 0),
         greatest(coalesce((v_row->>'extra_plays')::int, 0), 0),
         greatest(coalesce((v_row->>'weight')::int, 1), 1),
         nullif(trim(coalesce(v_row->>'colour', '')), ''),
         greatest(coalesce((v_row->>'daily_cap')::int, 0), 0),
         greatest(coalesce((v_row->>'weekly_cap')::int, 0), 0),
         coalesce((v_row->>'is_active')::boolean, true));
    else
      /* The row must belong to the game being saved, or a payload naming
         another game's prize id would edit that game's table from here. */
      select game into v_owner from public.affiliate_game_prizes where id = v_id;
      if v_owner is null or v_owner <> p_game then
        raise exception 'That prize does not belong to this game'
          using errcode = 'check_violation';
      end if;

      update public.affiliate_game_prizes
         set slot         = (v_row->>'slot')::int,
             label        = trim(v_row->>'label'),
             amount_minor = greatest(coalesce((v_row->>'amount_minor')::bigint, 0), 0),
             extra_plays  = greatest(coalesce((v_row->>'extra_plays')::int, 0), 0),
             weight       = greatest(coalesce((v_row->>'weight')::int, 1), 1),
             colour       = nullif(trim(coalesce(v_row->>'colour', '')), ''),
             daily_cap    = greatest(coalesce((v_row->>'daily_cap')::int, 0), 0),
             weekly_cap   = greatest(coalesce((v_row->>'weekly_cap')::int, 0), 0),
             is_active    = coalesce((v_row->>'is_active')::boolean, true),
             updated_at   = now()
       where id = v_id;
    end if;

    v_count := v_count + 1;
  end loop;

  /* A game with nothing drawable is a button that raises an exception at the
     person who pressed it. */
  select count(*) into v_active
    from public.affiliate_game_prizes
   where game = p_game and is_active and weight > 0;

  if v_active = 0 then
    raise exception 'At least one prize has to be active with a weight above zero'
      using errcode = 'check_violation';
  end if;

  return v_count;
end;
$$;

/* The list read gains the daily cap so the screen can show what it is about
   to save.

   ⚠️ DROPPED FIRST. Adding a column to a `returns table` changes the return
   type, and Postgres refuses that with `create or replace`: "cannot change
   return type of existing function". Dropping re-grants EXECUTE to PUBLIC on
   the way back in, which is why the grants block below is not optional. */
drop function if exists public.admin_list_affiliate_prizes(uuid, public.affiliate_game_kind);

create or replace function public.admin_list_affiliate_prizes(
  p_admin_id uuid,
  p_game public.affiliate_game_kind
)
returns table (
  id uuid,
  slot int,
  label text,
  amount_minor bigint,
  extra_plays int,
  weight int,
  colour text,
  daily_cap int,
  weekly_cap int,
  is_active boolean,
  times_won bigint,
  paid_minor bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.assert_admin(p_admin_id);

  return query
  select p.id, p.slot, p.label, p.amount_minor, p.extra_plays, p.weight, p.colour,
         p.daily_cap, p.weekly_cap, p.is_active,
         (select count(*) from public.affiliate_game_plays g where g.prize_id = p.id),
         (select coalesce(sum(g.amount_minor), 0)::bigint
            from public.affiliate_game_plays g where g.prize_id = p.id)
    from public.affiliate_game_prizes p
   where p.game = p_game
   order by p.slot;
end;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.admin_save_affiliate_prizes(uuid, public.affiliate_game_kind, jsonb)',
    'public.admin_list_affiliate_prizes(uuid, public.affiliate_game_kind)'
  ]
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;
