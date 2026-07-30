-- ============================================================================
-- Migration 065 — gift codes
--
-- Operator, 2026-07-30: an admin generates a code, attaches points to it, and
-- a user who enters the code wins those points. The admin never invents the
-- code themselves. A code may be revoked. A redeemed code is revoked
-- automatically, and "under no circumstance should a single code be redeemed
-- twice."
--
-- ONE CODE = ONE REDEMPTION, GLOBALLY. Not one per user. That is the operator's
-- wording read literally ("no user can trigger it again"), and it is the
-- stricter of the two readings, which is the right way to be wrong about money.
--
-- HOW "NEVER TWICE" IS ACTUALLY GUARANTEED
-- Not by the status column. A status is a convention that holds while every
-- code path remembers to check it. The guarantee here is a separate table,
-- `gift_code_redemptions`, with a UNIQUE constraint on gift_code_id: a second
-- redemption of one code is not refused, it is unrepresentable. Three further
-- layers sit on top, in order of when they fire:
--
--   1. SELECT ... FOR UPDATE on the code row, so two simultaneous redemptions
--      serialise rather than both reading 'active'.
--   2. The unique constraint, which is what actually cannot be got around.
--   3. points_ledger_source_once_idx, already in place, which independently
--      refuses a second credit against the same (user, type, reference).
--
-- Layer 2 is the one that matters. The others make the failure tidy.
--
-- WHY NOT `random()`
-- `generate_referral_code` uses `random()`, which is fine there — a referral
-- code is public and carries nothing. A gift code carries points, and
-- Postgres's random() is a seeded deterministic PRNG: someone who observes a
-- run of codes can work towards predicting others. These use
-- `extensions.gen_random_bytes`, which is the CSPRNG, over the same
-- unambiguous alphabet.
--
-- BRUTE FORCE IS A REAL ATTACK HERE, not a theoretical one: a valid guess pays
-- out. 12 characters over a 32-symbol alphabet is 32^12 ≈ 1.2e18, which is not
-- guessable, but a per-user attempt limit is still enforced so that trying is
-- visibly futile rather than merely expensive.
-- ============================================================================


create type public.gift_code_status as enum ('active', 'redeemed', 'revoked');


create table public.gift_codes (
  id uuid primary key default gen_random_uuid(),

  -- Stored uppercase; lookups normalise. Users will type these off a screen
  -- or a WhatsApp message, so case must not decide whether they get paid.
  code text not null unique
    check (code = upper(code) and code ~ '^[0-9A-HJKMNP-TV-Z]{12}$'),

  points bigint not null check (points > 0),

  status public.gift_code_status not null default 'active',

  -- Free text for the operator's own benefit: which campaign, which radio
  -- spot, which apology this was for.
  note text check (note is null or length(note) <= 200),

  -- Optional. Null means it does not expire on its own.
  expires_at timestamptz,

  created_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),

  revoked_by uuid references auth.users (id) on delete set null,
  revoked_at timestamptz,

  updated_at timestamptz not null default now(),

  -- A revoked code must say who and when. Without this a code could sit in
  -- 'revoked' with no account of how it got there.
  constraint gift_codes_revoked_has_actor
    check (status <> 'revoked' or (revoked_by is not null and revoked_at is not null))
);

comment on table public.gift_codes is
  'Single-use point vouchers. One code is redeemable exactly once, ever, by exactly one account — enforced by the unique constraint on gift_code_redemptions.gift_code_id, not by the status column.';

create index gift_codes_status_idx on public.gift_codes (status, created_at desc);
create index gift_codes_created_by_idx on public.gift_codes (created_by);

create trigger gift_codes_touch_updated_at
  before update on public.gift_codes
  for each row execute function public.touch_updated_at();


-- ---------------------------------------------------------------------------
-- gift_code_redemptions — the guarantee
-- ---------------------------------------------------------------------------
--
-- This table exists for its UNIQUE constraint. Everything it records could
-- have been columns on `gift_codes`; as a separate row with `unique
-- (gift_code_id)` it becomes impossible for the database to hold two
-- redemptions of one code, whatever any function later does wrong.

create table public.gift_code_redemptions (
  id uuid primary key default gen_random_uuid(),

  gift_code_id uuid not null unique references public.gift_codes (id) on delete restrict,
  user_id      uuid not null references auth.users (id) on delete cascade,

  -- Recorded as paid, not looked up later: editing a code's points afterwards
  -- must not rewrite what somebody already received.
  points_awarded bigint not null check (points_awarded > 0),

  created_at timestamptz not null default now()
);

comment on table public.gift_code_redemptions is
  'One row per code ever redeemed. The unique constraint on gift_code_id is the actual guarantee that a code cannot be redeemed twice — the status column on gift_codes is a convenience for querying.';

create index gift_code_redemptions_user_idx on public.gift_code_redemptions (user_id, created_at desc);


-- ---------------------------------------------------------------------------
-- Failed attempts, so guessing is bounded
-- ---------------------------------------------------------------------------

create table public.gift_code_attempts (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  -- The code TRIED, kept for the fraud picture. Not a secret: by definition
  -- it did not work.
  attempted text not null,
  created_at timestamptz not null default now()
);

create index gift_code_attempts_user_idx on public.gift_code_attempts (user_id, created_at desc);


insert into public.app_config
  (key, value, value_type, min_value, max_value, is_public, description)
values
  ('gift_code_max_attempts_per_hour', '10', 'int', 1, 1000, false,
   'How many wrong gift codes one account may try per hour before being refused. A valid guess pays out, so this is the brake on brute force; the code space itself (32^12) is what makes guessing hopeless.')
on conflict (key) do nothing;


-- ---------------------------------------------------------------------------
-- generate_gift_code — a candidate, not a row
-- ---------------------------------------------------------------------------
--
-- Returns an unused code WITHOUT creating anything. The admin form shows it
-- while the operator types the points value, and the row is only written when
-- they save — so abandoning a half-filled form leaves no orphan code behind.
--
-- The uniqueness check here is a convenience that keeps the form honest; the
-- unique constraint on insert is what actually prevents a collision.

create or replace function public.generate_gift_code()
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  -- Crockford-style: no I, L, O or U, so a code read off a screen or out of a
  -- WhatsApp message cannot be mistyped into a different valid code.
  alphabet constant text := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  candidate text;
  bytes     bytea;
  attempt   int := 0;
begin
  loop
    candidate := '';
    -- CSPRNG, not random(). A gift code is worth points; a predictable one is
    -- a withdrawal waiting to happen.
    bytes := extensions.gen_random_bytes(12);
    for i in 0 .. 11 loop
      candidate := candidate
        || substr(alphabet, 1 + (get_byte(bytes, i) % length(alphabet)), 1);
    end loop;

    exit when not exists (select 1 from public.gift_codes g where g.code = candidate);

    attempt := attempt + 1;
    if attempt >= 10 then
      raise exception 'Could not generate a unique gift code after % attempts', attempt;
    end if;
  end loop;

  return candidate;
end;
$$;

revoke execute on function public.generate_gift_code() from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- admin_create_gift_code — code and points arrive together
-- ---------------------------------------------------------------------------
--
-- Operator: "generation of the code and setting the points value should be
-- parallel just like entering values for a form." So this takes both at once
-- and writes one row. The code comes from `generate_gift_code` via the form,
-- and is re-validated here rather than trusted: an admin's browser is still a
-- client, and a hand-typed code would defeat the point of generating them.

create or replace function public.admin_create_gift_code(
  p_admin_id   uuid,
  p_code       text,
  p_points     bigint,
  p_note       text default null,
  p_expires_at timestamptz default null
)
returns public.gift_codes
language plpgsql
security definer
set search_path = ''
as $$
declare v_row public.gift_codes;
begin
  perform public.assert_admin(p_admin_id);

  if p_points is null or p_points <= 0 then
    raise exception 'Set how many points this code is worth'
      using errcode = 'check_violation';
  end if;

  if p_code is null or upper(trim(p_code)) !~ '^[0-9A-HJKMNP-TV-Z]{12}$' then
    -- Reached when a client sends something the generator did not produce.
    raise exception 'That is not a generated code. Use the code from the form.'
      using errcode = 'check_violation';
  end if;

  if p_expires_at is not null and p_expires_at <= now() then
    raise exception 'An expiry date has to be in the future'
      using errcode = 'check_violation';
  end if;

  insert into public.gift_codes (code, points, note, expires_at, created_by)
  values (upper(trim(p_code)), p_points, nullif(trim(p_note), ''), p_expires_at, p_admin_id)
  returning * into v_row;

  return v_row;
end;
$$;

revoke execute on function public.admin_create_gift_code(uuid, text, bigint, text, timestamptz)
  from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- admin_revoke_gift_code
-- ---------------------------------------------------------------------------
--
-- Only an active code can be revoked. Revoking a redeemed one is refused
-- rather than ignored: the points are already in somebody's balance, and a
-- screen that let an operator "revoke" that would be telling them something
-- untrue about what they had just done.

create or replace function public.admin_revoke_gift_code(
  p_admin_id uuid,
  p_code_id  uuid
)
returns public.gift_codes
language plpgsql
security definer
set search_path = ''
as $$
declare v_row public.gift_codes;
begin
  perform public.assert_admin(p_admin_id);

  select * into v_row from public.gift_codes where id = p_code_id for update;
  if not found then
    raise exception 'Gift code not found' using errcode = 'check_violation';
  end if;

  if v_row.status = 'redeemed' then
    raise exception 'That code has already been redeemed and cannot be revoked'
      using errcode = 'check_violation';
  end if;

  if v_row.status = 'revoked' then
    return v_row;                       -- idempotent; a second click is a no-op
  end if;

  update public.gift_codes
     set status = 'revoked', revoked_by = p_admin_id, revoked_at = now()
   where id = p_code_id
  returning * into v_row;

  return v_row;
end;
$$;

revoke execute on function public.admin_revoke_gift_code(uuid, uuid)
  from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- redeem_gift_code — the money path
-- ---------------------------------------------------------------------------
--
-- Returns jsonb rather than raising for the ordinary refusals, because "that
-- code is not valid" is a normal thing for a user to hit and should not read
-- as a system error. Genuine faults still raise.
--
-- Outcomes: ok | not_found | already_used | revoked | expired | rate_limited
--           | account_disabled

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

revoke execute on function public.redeem_gift_code(uuid, text) from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- admin_list_gift_codes
-- ---------------------------------------------------------------------------

create or replace function public.admin_list_gift_codes(p_status public.gift_code_status default null)
returns table (
  id uuid,
  code text,
  points bigint,
  status public.gift_code_status,
  note text,
  expires_at timestamptz,
  created_at timestamptz,
  created_by_name text,
  redeemed_at timestamptz,
  redeemed_by_name text,
  redeemed_by_email text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  -- Same guard as admin_list_redemptions: an admin's own token answers to
  -- is_admin(); a null caller is the service client and already trusted.
  if (select auth.uid()) is not null and not public.is_admin() then
    raise exception 'Not an administrator' using errcode = 'insufficient_privilege';
  end if;

  return query
  select
    g.id, g.code, g.points, g.status, g.note, g.expires_at, g.created_at,
    creator.full_name,
    r.created_at,
    p.full_name,
    u.email::text
  from public.gift_codes g
  left join public.profiles creator on creator.id = g.created_by
  left join public.gift_code_redemptions r on r.gift_code_id = g.id
  left join public.profiles p on p.id = r.user_id
  left join auth.users u on u.id = r.user_id
  where p_status is null or g.status = p_status
  order by g.created_at desc;
end;
$$;

revoke execute on function public.admin_list_gift_codes(public.gift_code_status) from public, anon;
grant execute on function public.admin_list_gift_codes(public.gift_code_status)
  to authenticated, service_role;


-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
--
-- gift_codes is ADMIN-READ-ONLY. A user must never be able to list codes —
-- that would hand them every unredeemed voucher on the platform. There is
-- deliberately no "read the one I am about to redeem" policy either; the
-- redemption path runs SECURITY DEFINER and needs no client read at all.

alter table public.gift_codes enable row level security;

create policy "Only admins may read gift codes"
  on public.gift_codes for select
  to authenticated
  using (public.is_admin());

alter table public.gift_code_redemptions enable row level security;

create policy "Read own redemption or all as admin"
  on public.gift_code_redemptions for select
  to authenticated
  using ((select auth.uid()) = user_id or public.is_admin());

alter table public.gift_code_attempts enable row level security;

create policy "Only admins may read attempts"
  on public.gift_code_attempts for select
  to authenticated
  using (public.is_admin());
