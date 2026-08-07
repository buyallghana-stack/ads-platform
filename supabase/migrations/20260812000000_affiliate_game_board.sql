-- ---------------------------------------------------------------------------
-- The faces of an affiliate game: what the wheel shows and what the boxes hide.
--
-- Mirrors `get_game_board` exactly, including the one thing that matters about
-- it: THE WEIGHTS NEVER LEAVE THE DATABASE. A player who can read the odds
-- knows which wedge is worth landing on, which turns a mystery box into a
-- lookup table. Only slot, label, amount, extra plays and colour come out.
--
-- Without this the affiliate games could not draw the real board, which is why
-- they shipped as two plain cards rather than the wheel and the boxes the ads
-- side has (operator, 2026-08-07: "the wheel never comes, the mystery box
-- never show up").
-- ---------------------------------------------------------------------------

create or replace function public.affiliate_game_board(p_game public.affiliate_game_kind)
returns table (
  slot int,
  label text,
  amount_minor bigint,
  extra_plays int,
  colour text
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.slot, p.label, p.amount_minor, p.extra_plays, p.colour
    from public.affiliate_game_prizes p
   where p.game = p_game and p.is_active
   order by p.slot;
$$;

/* ⚠️ `create function` re-grants EXECUTE to PUBLIC. Server-only, like every
   other Phase 2 read: the screens call it through the service client from
   inside the affiliate route group. */
revoke execute on function public.affiliate_game_board(public.affiliate_game_kind)
  from public, anon, authenticated;
grant execute on function public.affiliate_game_board(public.affiliate_game_kind)
  to service_role;
