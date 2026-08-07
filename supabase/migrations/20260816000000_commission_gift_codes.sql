-- ---------------------------------------------------------------------------
-- Gift codes for the affiliate business, paying CEDIS.
--
-- The affiliate dashboard has carried a Gift code tile since the tile row was
-- built, and it pointed at `/gift-code` — the ads screen, which credits POINTS.
-- The note beside it argued that was fine because the two balances stay
-- separate and the user simply walks between them. The operator's answer
-- (2026-08-07) is that it is not fine: "the gift code of the affiliate when
-- clicked takes you to the ads ... the gift code that exists is just for the
-- ads." An affiliate earning cedis who taps a tile on the cedis dashboard
-- expects cedis.
--
-- ── A SECOND TABLE, NOT A COLUMN ON THE FIRST ──
--
-- D27: the two businesses share no table and no function. A `currency` column
-- on `gift_codes` would put a points code and a cedis code one WHERE clause
-- apart, and the first query that forgets the clause pays the wrong money out
-- of the wrong balance. Two tables cannot make that mistake.
--
-- The status ENUM is reused, and that is not a breach. `active / redeemed /
-- revoked` is a vocabulary for the life of a code, not a unit of money.
--
-- ── WHAT IT CREDITS ──
--
-- A cleared `adjustment` on the commission ledger, which is the same entry the
-- admin uses to correct a balance by hand. It is not a `credit`: that shape is
-- reserved for money that came from a conversion and the table enforces it
-- (`commission_credit_shape` requires a conversion_id). A gift is not a sale.
-- ---------------------------------------------------------------------------

create table if not exists public.commission_gift_codes (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,
  /* Minor units, like every other money column in this schema. A gift of
     GHS 5 is 500 here, and nothing in the app ever multiplies by 100 twice. */
  amount_minor bigint not null check (amount_minor > 0),
  status      public.gift_code_status not null default 'active',
  note        text,
  expires_at  timestamptz,
  created_by  uuid not null references auth.users(id),
  created_at  timestamptz not null default now(),
  revoked_by  uuid references auth.users(id),
  revoked_at  timestamptz,
  updated_at  timestamptz not null default now()
);

create table if not exists public.commission_gift_code_redemptions (
  id             uuid primary key default gen_random_uuid(),
  gift_code_id   uuid not null references public.commission_gift_codes(id) on delete cascade,
  affiliate_id   uuid not null references public.affiliate_accounts(id) on delete cascade,
  user_id        uuid not null references auth.users(id) on delete cascade,
  amount_minor   bigint not null,
  created_at     timestamptz not null default now(),
  /* THE GUARANTEE. One redemption per code, enforced by the database rather
     than by whoever writes the next redemption path. */
  constraint commission_gift_redeemed_once unique (gift_code_id)
);

create index if not exists commission_gift_redemptions_user_idx
  on public.commission_gift_code_redemptions (user_id);

alter table public.commission_gift_codes enable row level security;
alter table public.commission_gift_code_redemptions enable row level security;

/* No policy for either: every path goes through a security-definer function
   below, so the anon and authenticated keys can reach neither table. A code is
   a bearer token — a SELECT policy on this table is a list of free money. */

drop policy if exists commission_gift_redemptions_own on public.commission_gift_code_redemptions;
create policy commission_gift_redemptions_own
  on public.commission_gift_code_redemptions for select
  using (user_id = (select auth.uid()) or public.is_admin());

drop trigger if exists commission_gift_codes_touch on public.commission_gift_codes;
create trigger commission_gift_codes_touch
  before update on public.commission_gift_codes
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------

create or replace function public.generate_commission_gift_code()
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  /* The ads alphabet, character for character, and the same 12 characters.
     Not because the codes are interchangeable — they are not, they live in
     different tables and buy different money — but because the INPUT is: the
     field uppercases, strips spaces and dashes and rejects anything outside
     this set, and two alphabets would mean two sets of that hygiene and one of
     them eventually wrong.

     Crockford-style: no I, L, O or U, so a code read off a screen or out of a
     WhatsApp message cannot be mistyped into a different valid one. */
  alphabet constant text := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  candidate text;
  bytes     bytea;
  attempt   int := 0;
begin
  loop
    candidate := '';
    /* ⚠️ CSPRNG, NOT random(). This code is worth CEDIS. `random()` is seeded
       per session and guessable, so a predictable code here is somebody
       enumerating the codebook and withdrawing real money. The ads generator
       carries this same note and it applies harder on this side. */
    bytes := extensions.gen_random_bytes(12);
    for i in 0 .. 11 loop
      candidate := candidate
        || substr(alphabet, 1 + (get_byte(bytes, i) % length(alphabet)), 1);
    end loop;

    exit when not exists (
      select 1 from public.commission_gift_codes g where g.code = candidate
    );

    attempt := attempt + 1;
    if attempt >= 10 then
      raise exception 'Could not generate a unique commission gift code after % attempts', attempt;
    end if;
  end loop;

  return candidate;
end;
$$;

-- ---------------------------------------------------------------------------

create or replace function public.redeem_commission_gift_code(
  p_user_id uuid,
  p_code    text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_code   record;
  v_aff_id uuid;
begin
  select id into v_aff_id
    from public.affiliate_accounts
   where user_id = p_user_id;

  /* Refused rather than enrolled. Creating an affiliate account as a side
     effect of typing a code would sign somebody up to a second business, with
     a terms acceptance stamped in their name, because they pasted a string. */
  if v_aff_id is null then
    return jsonb_build_object('outcome', 'no_account');
  end if;

  /* Locked, so two tabs racing the same code serialise here instead of both
     reading `active`. The unique constraint is still the guarantee; this only
     turns a raised exception into an orderly answer. */
  select * into v_code
    from public.commission_gift_codes
   where upper(code) = upper(btrim(p_code))
   for update;

  if not found then
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

  begin
    insert into public.commission_gift_code_redemptions
      (gift_code_id, affiliate_id, user_id, amount_minor)
    values (v_code.id, v_aff_id, p_user_id, v_code.amount_minor);
  exception when unique_violation then
    return jsonb_build_object('outcome', 'already_used');
  end;

  insert into public.commission_ledger
    (affiliate_id, entry_type, amount_minor, status, reason, idempotency_key)
  values (
    v_aff_id, 'adjustment', v_code.amount_minor, 'cleared',
    'Gift code ' || v_code.code,
    'commission-gift-' || v_code.id::text
  );

  update public.commission_gift_codes
     set status = 'redeemed'
   where id = v_code.id;

  perform public.create_notification(
    p_user_id,
    'payout',
    'Gift code redeemed',
    'GHS ' || to_char(v_code.amount_minor / 100.0, 'FM999999990.00') ||
      ' has been added to your commission balance.',
    jsonb_build_object('commission_gift_code_id', v_code.id, 'amount_minor', v_code.amount_minor)
  );

  return jsonb_build_object(
    'outcome', 'ok',
    'amount_minor', v_code.amount_minor,
    'code', v_code.code
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Admin
-- ---------------------------------------------------------------------------

create or replace function public.admin_create_commission_gift_code(
  p_admin_id    uuid,
  p_code        text,
  p_amount_minor bigint,
  p_note        text default null,
  p_expires_at  timestamptz default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_code text;
  v_row  public.commission_gift_codes;
begin
  perform public.assert_admin(p_admin_id);

  if p_amount_minor is null or p_amount_minor <= 0 then
    return jsonb_build_object('outcome', 'bad_amount');
  end if;

  v_code := upper(btrim(coalesce(nullif(btrim(p_code), ''),
                                 public.generate_commission_gift_code())));

  if exists (select 1 from public.commission_gift_codes where upper(code) = v_code) then
    return jsonb_build_object('outcome', 'duplicate');
  end if;

  insert into public.commission_gift_codes
    (code, amount_minor, note, expires_at, created_by)
  values (v_code, p_amount_minor, nullif(btrim(p_note), ''), p_expires_at, p_admin_id)
  returning * into v_row;

  return jsonb_build_object('outcome', 'ok', 'code', v_row.code, 'id', v_row.id);
end;
$$;

create or replace function public.admin_revoke_commission_gift_code(
  p_admin_id uuid,
  p_code_id  uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_row public.commission_gift_codes;
begin
  perform public.assert_admin(p_admin_id);

  select * into v_row from public.commission_gift_codes where id = p_code_id for update;
  if not found then
    return jsonb_build_object('outcome', 'not_found');
  end if;
  /* A spent code cannot be un-spent. Revoking it would say the money was never
     given, and the ledger says otherwise. */
  if v_row.status = 'redeemed' then
    return jsonb_build_object('outcome', 'already_used');
  end if;

  update public.commission_gift_codes
     set status = 'revoked', revoked_by = p_admin_id, revoked_at = now()
   where id = p_code_id;

  return jsonb_build_object('outcome', 'ok');
end;
$$;

create or replace function public.admin_list_commission_gift_codes(
  p_admin_id uuid,
  p_status   public.gift_code_status default null
)
returns table (
  id            uuid,
  code          text,
  amount_minor  bigint,
  status        text,
  note          text,
  expires_at    timestamptz,
  created_at    timestamptz,
  redeemed_at   timestamptz,
  redeemed_by   text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.assert_admin(p_admin_id);

  return query
    select g.id, g.code, g.amount_minor, g.status::text, g.note, g.expires_at, g.created_at,
           r.created_at,
           coalesce(p.full_name, u.email)
      from public.commission_gift_codes g
      left join public.commission_gift_code_redemptions r on r.gift_code_id = g.id
      left join auth.users u on u.id = r.user_id
      left join public.profiles p on p.id = r.user_id
     where p_status is null or g.status = p_status
     order by g.created_at desc;
end;
$$;

/* ⚠️ `create function` GRANTS EXECUTE TO PUBLIC. Every one of these either
   moves money or lists live gift codes; without the revoke, the anon key
   could read the whole codebook. */
revoke execute on function public.generate_commission_gift_code() from public, anon, authenticated;
revoke execute on function public.redeem_commission_gift_code(uuid, text) from public, anon, authenticated;
revoke execute on function public.admin_create_commission_gift_code(uuid, text, bigint, text, timestamptz) from public, anon, authenticated;
revoke execute on function public.admin_revoke_commission_gift_code(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.admin_list_commission_gift_codes(uuid, public.gift_code_status) from public, anon, authenticated;

grant execute on function public.generate_commission_gift_code() to service_role;
grant execute on function public.redeem_commission_gift_code(uuid, text) to service_role;
grant execute on function public.admin_create_commission_gift_code(uuid, text, bigint, text, timestamptz) to service_role;
grant execute on function public.admin_revoke_commission_gift_code(uuid, uuid) to service_role;
grant execute on function public.admin_list_commission_gift_codes(uuid, public.gift_code_status) to service_role;
