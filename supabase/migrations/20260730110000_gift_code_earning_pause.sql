-- ============================================================================
-- Migration 066 — a paused platform refuses a gift code HONESTLY
--
-- THE BUG. `credit_points` raises 'Earning is paused platform-wide' for every
-- entry type except `redemption_refund` (migration 051). `redeem_gift_code`
-- did not anticipate that, so with the §6.6 emergency switch on:
--
--   * the exception escaped the function,
--   * the server action's generic `error` branch caught it,
--   * the user was told "Something went wrong" about a code that is perfectly
--     valid and will work again later, and
--   * `reportUnexpected` filed it in Sentry as an unexplained fault.
--
-- The last one is the reason this is worth a migration rather than a shrug.
-- The Sentry work's own rule is that expected refusals must not alert — a
-- tracker that cries about wrong PINs and insufficient balances is a tracker
-- nobody reads. Flipping the emergency switch would have filled it with one
-- report per gift code attempted, which is precisely when somebody needs to be
-- able to trust it.
--
-- THE PLATFORM STILL REFUSES. This is not a hole punched in the pause: a gift
-- code is points, the switch exists to stop points moving, and letting the
-- operator's own vouchers through while everything else is frozen would be a
-- surprising exception to an emergency control. Only the ANSWER changes.
--
-- WHERE THE CHECK SITS, and why it is not earlier. It goes after every
-- question about the code itself has been settled and immediately before the
-- redemption is recorded. So:
--
--   * a code that is genuinely wrong / used / revoked / expired still gets its
--     own honest answer during a pause — those are permanent facts and a
--     paused platform does not make them less true;
--   * a VALID code is left completely untouched: nothing is inserted, nothing
--     credited, no attempt spent. The user can walk in tomorrow and redeem it.
--
-- Putting it at the top instead would have told somebody holding a dud code
-- to come back later, which is a wasted trip.
--
-- THE REMAINING RACE IS DELIBERATE. If the switch is flipped in the moment
-- between this check and `credit_points`, the old behaviour happens once. It
-- is not worth closing: the alternative is widening the exception block over
-- the insert and the credit and catching by message text, which would also
-- swallow real check violations and report them as a pause. A wrong answer on
-- a money path is worse than a rare unhelpful one, and the whole statement
-- rolls back either way, so the code is never consumed without being paid.
-- ============================================================================


-- Restated from the LIVE `pg_get_functiondef`, not from migration 065's file
-- (they were byte-identical here — nothing has amended it — but that is
-- something to VERIFY rather than assume; see the notes on `credit_points`,
-- which four migrations had rewritten out from under its original text).
--
-- Outcomes: ok | not_found | already_used | revoked | expired | rate_limited
--           | account_disabled | earning_paused

create or replace function public.redeem_gift_code(
  p_user_id uuid,
  p_code    text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code     public.gift_codes;
  v_profile  public.profiles;
  v_attempts int;
  v_limit    int;
  v_norm     text := upper(trim(coalesce(p_code, '')));
begin
  select * into v_profile from public.profiles where id = p_user_id;
  if not found then
    raise exception 'Unknown user' using errcode = 'check_violation';
  end if;

  -- Same refusal apply_referral_code makes. A disabled account must not be
  -- able to top itself up while it is under review.
  if v_profile.disabled_at is not null then
    return jsonb_build_object('outcome', 'account_disabled');
  end if;

  -- --- Brute-force brake --------------------------------------------------
  v_limit := coalesce(public.config_int('gift_code_max_attempts_per_hour')::int, 10);
  select count(*) into v_attempts
    from public.gift_code_attempts a
   where a.user_id = p_user_id and a.created_at > now() - interval '1 hour';

  if v_attempts >= v_limit then
    return jsonb_build_object('outcome', 'rate_limited');
  end if;

  if v_norm !~ '^[0-9A-HJKMNP-TV-Z]{12}$' then
    insert into public.gift_code_attempts (user_id, attempted) values (p_user_id, v_norm);
    return jsonb_build_object('outcome', 'not_found');
  end if;

  /*
    FOR UPDATE is load-bearing. Two requests redeeming the same code at the
    same instant would otherwise both read status = 'active' and both proceed;
    the unique constraint below would still stop the second from being
    recorded, but this makes them queue rather than race into an exception.
  */
  select * into v_code from public.gift_codes where code = v_norm for update;

  if not found then
    -- Logged as an attempt: this is the shape brute force takes.
    insert into public.gift_code_attempts (user_id, attempted) values (p_user_id, v_norm);
    return jsonb_build_object('outcome', 'not_found');
  end if;

  if v_code.status = 'redeemed' then
    return jsonb_build_object('outcome', 'already_used');
  end if;
  if v_code.status = 'revoked' then
    return jsonb_build_object('outcome', 'revoked');
  end if;
  if v_code.expires_at is not null and v_code.expires_at <= now() then
    return jsonb_build_object('outcome', 'expired');
  end if;

  /*
    The code is good. `credit_points` is about to refuse it if the emergency
    switch is on, so ask first and say so plainly — and, crucially, return
    BEFORE anything is written, so the code survives the pause intact.
  */
  if public.config_bool('earning_paused_globally') then
    return jsonb_build_object('outcome', 'earning_paused');
  end if;

  /*
    THE GUARANTEE. Unique on gift_code_id — a second redemption of this code
    cannot be written, by this function or any future one. If a concurrent
    transaction beat us here despite the lock, this raises 23505 and the
    handler below reports it honestly as already used.
  */
  begin
    insert into public.gift_code_redemptions (gift_code_id, user_id, points_awarded)
    values (v_code.id, p_user_id, v_code.points);
  exception when unique_violation then
    return jsonb_build_object('outcome', 'already_used');
  end;

  perform public.credit_points(
    p_user_id, v_code.points, 'gift_code', 'gift_code', v_code.id::text,
    jsonb_build_object('code', v_code.code, 'note', v_code.note)
  );

  -- Redeeming revokes it. The operator asked for this explicitly, and it also
  -- means the queryable status can never disagree with the redemptions table.
  update public.gift_codes
     set status = 'redeemed'
   where id = v_code.id;

  perform public.create_notification(
    p_user_id,
    'payout',
    'Gift code redeemed',
    v_code.points::text || ' points have been added to your balance.',
    jsonb_build_object('gift_code_id', v_code.id, 'points', v_code.points)
  );

  return jsonb_build_object(
    'outcome', 'ok',
    'points', v_code.points,
    'code', v_code.code
  );
end;
$$;

-- Unchanged from 065, restated because CREATE OR REPLACE does not carry
-- grants forward on its own here and leaving this to memory is how a money
-- function ends up callable by `authenticated`.
revoke execute on function public.redeem_gift_code(uuid, text) from public, anon, authenticated;
