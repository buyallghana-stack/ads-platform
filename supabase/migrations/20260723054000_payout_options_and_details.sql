-- ============================================================================
-- Migration 017 — Payout options and user payout details (§6.4.1)
--
-- Two admin-managed lists — crypto coins with their networks, and mobile money
-- providers — plus the details each user saves against them.
--
-- The rule that drives the shape: NO CODE MAY BRANCH ON A SPECIFIC COIN.
-- §6.4.1 is explicit that `if (coin === 'USDT')` must never be written.
-- Whether a coin needs a network choice is a flag on the coin; which networks
-- it offers are rows; how an address is validated is a pattern stored on the
-- record. Adding a second multi-network coin later is data entry.
--
-- Why validation patterns live on the row
-- ---------------------------------------
-- A stablecoin sent on the wrong network is gone permanently — not delayed,
-- not recoverable, gone. So the address format check has to travel with the
-- coin and network rather than living in application code that may not have
-- been updated when a new coin was added.
--
-- The rail_confirmed guard
-- ------------------------
-- §6.4.1 warns about this directly: adding an entry in the dashboard does not
-- create the ability to pay it. A coin only pays out if the crypto gateway
-- supports that chain, and a provider only pays out if Korapay supports it.
-- So an entry cannot be made active until someone has confirmed the underlying
-- rail. Enforced by CHECK, not by remembering.
--
-- Deactivate, never delete
-- ------------------------
-- Users hold saved details referencing these rows. Deleting one would orphan
-- their record; deactivating hides it from new selections while preserving
-- history. The foreign keys are RESTRICT so deletion is refused outright.
-- ============================================================================


create type public.payout_method as enum ('crypto', 'mobile_money');


-- ---------------------------------------------------------------------------
-- payout_coins
-- ---------------------------------------------------------------------------

create table public.payout_coins (
  id uuid primary key default gen_random_uuid(),

  code text not null unique check (code = upper(code) and code ~ '^[A-Z0-9]{2,12}$'),
  name text not null,

  -- Whether the user must pick a network. Read from here, never inferred from
  -- the code (§6.4.1).
  requires_network boolean not null default false,

  -- Fallback address pattern for single-network coins. When a network is
  -- required the network's own pattern takes precedence.
  address_pattern text,

  -- Set only once the crypto gateway is confirmed to support this asset.
  rail_confirmed boolean not null default false,
  rail_notes     text,

  is_active  boolean not null default false,
  sort_order int not null default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- The §6.4.1 guard: no entry goes live on an unconfirmed rail.
  constraint payout_coins_active_needs_rail check (not is_active or rail_confirmed),

  -- A coin that does not require a network must be able to validate addresses
  -- on its own, or nothing checks them at all.
  constraint payout_coins_single_network_has_pattern
    check (requires_network or address_pattern is not null)
);

comment on table public.payout_coins is
  'Admin-managed coin list. requires_network and address_pattern are data, so no code branches on a coin code (§6.4.1).';

create index payout_coins_active_idx on public.payout_coins (is_active, sort_order) where is_active;


-- ---------------------------------------------------------------------------
-- payout_coin_networks
-- ---------------------------------------------------------------------------

create table public.payout_coin_networks (
  id uuid primary key default gen_random_uuid(),
  coin_id uuid not null references public.payout_coins (id) on delete restrict,

  code text not null check (code = upper(code) and code ~ '^[A-Z0-9-]{2,16}$'),
  name text not null,

  -- Per-network address format. TRC20 addresses look nothing like ERC20 ones,
  -- which is exactly why sending to the wrong one loses the funds.
  address_pattern text not null,

  rail_confirmed boolean not null default false,
  rail_notes     text,

  is_active  boolean not null default false,
  sort_order int not null default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (coin_id, code),
  constraint payout_networks_active_needs_rail check (not is_active or rail_confirmed)
);

comment on table public.payout_coin_networks is
  'Networks per coin, each with its own address pattern. A stablecoin sent on the wrong network is unrecoverable, so the pattern travels with the network.';

create index payout_coin_networks_coin_idx on public.payout_coin_networks (coin_id, is_active, sort_order);


-- ---------------------------------------------------------------------------
-- payout_providers — mobile money (the Korapay rail)
-- ---------------------------------------------------------------------------

create table public.payout_providers (
  id uuid primary key default gen_random_uuid(),

  code text not null unique check (code = upper(code) and code ~ '^[A-Z0-9_]{2,20}$'),
  name text not null,

  -- Per-provider MSISDN pattern. Ghanaian prefixes are allocated per network,
  -- so this also catches "right number, wrong provider selected", which would
  -- otherwise fail at Korapay after the user has waited days.
  number_pattern text not null,

  country_code text not null default 'GH' check (country_code ~ '^[A-Z]{2}$'),

  rail_confirmed boolean not null default false,
  rail_notes     text,

  is_active  boolean not null default false,
  sort_order int not null default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint payout_providers_active_needs_rail check (not is_active or rail_confirmed)
);

comment on table public.payout_providers is
  'Admin-managed mobile money providers. number_pattern is per provider so a wrong-provider selection is caught here rather than by Korapay days later.';

create index payout_providers_active_idx on public.payout_providers (is_active, sort_order) where is_active;


-- ---------------------------------------------------------------------------
-- user_payout_details
-- ---------------------------------------------------------------------------
--
-- One row per user per method (§6.4.1: users hold details for both, and choose
-- at redemption). Sensitive data — RLS restricts reads to the owner and
-- admins, and nothing here is ever written to application logs.

create table public.user_payout_details (
  user_id uuid not null references auth.users (id) on delete cascade,
  method  public.payout_method not null,

  -- --- crypto ---
  coin_id        uuid references public.payout_coins (id) on delete restrict,
  network_id     uuid references public.payout_coin_networks (id) on delete restrict,
  wallet_address text,

  -- --- mobile money ---
  provider_id  uuid references public.payout_providers (id) on delete restrict,
  msisdn       text,
  account_name text,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  last_changed_at timestamptz not null default now(),

  primary key (user_id, method),

  -- Each method must be fully populated, and must not carry the other's
  -- fields. A half-filled record is worse than none: it looks ready and fails
  -- at payout.
  constraint user_payout_details_shape check (
    case method
      when 'crypto' then
        coin_id is not null and wallet_address is not null
        and provider_id is null and msisdn is null and account_name is null
      when 'mobile_money' then
        provider_id is not null and msisdn is not null
        and account_name is not null and length(trim(account_name)) >= 2
        and coin_id is null and network_id is null and wallet_address is null
    end
  )
);

comment on table public.user_payout_details is
  'Per-user payout destinations. Sensitive: owner and admin read only, never written to application logs (§6.4.1).';

create index user_payout_details_coin_idx     on public.user_payout_details (coin_id)     where coin_id is not null;
create index user_payout_details_network_idx  on public.user_payout_details (network_id)  where network_id is not null;
create index user_payout_details_provider_idx on public.user_payout_details (provider_id) where provider_id is not null;


-- ---------------------------------------------------------------------------
-- payout_detail_changes — audit trail feeding the fraud score
-- ---------------------------------------------------------------------------
--
-- Changing where the money goes immediately before cashing out is a classic
-- takeover pattern (§6.4.1), so every change is recorded and scored.
--
-- Values are stored MASKED. The live destination lives in
-- user_payout_details; this table exists to answer "did it change, when, and
-- roughly to what", which masked values answer without creating a second
-- copy of everyone's wallet addresses.

create table public.payout_detail_changes (
  id bigint generated always as identity primary key,

  user_id uuid not null references auth.users (id) on delete cascade,
  method  public.payout_method not null,

  old_masked text,
  new_masked text,

  ip inet,
  created_at timestamptz not null default now()
);

comment on table public.payout_detail_changes is
  'Masked history of payout destination changes. Deliberately not a second copy of the plaintext (§6.4.1).';

create index payout_detail_changes_user_idx on public.payout_detail_changes (user_id, created_at desc);


-- ---------------------------------------------------------------------------
-- Masking helper
-- ---------------------------------------------------------------------------

create or replace function public.mask_payout_value(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_value is null then null
    when length(p_value) <= 8 then repeat('*', greatest(length(p_value) - 2, 0)) || right(p_value, 2)
    else left(p_value, 4) || repeat('*', 4) || right(p_value, 4)
  end;
$$;

comment on function public.mask_payout_value(text) is
  'Masks a wallet address or phone number for logging. Keeps enough to recognise, not enough to use.';


-- ---------------------------------------------------------------------------
-- Housekeeping and audit
-- ---------------------------------------------------------------------------

create trigger payout_coins_touch          before update on public.payout_coins          for each row execute function public.touch_updated_at();
create trigger payout_coin_networks_touch  before update on public.payout_coin_networks  for each row execute function public.touch_updated_at();
create trigger payout_providers_touch      before update on public.payout_providers      for each row execute function public.touch_updated_at();
create trigger user_payout_details_touch   before update on public.user_payout_details   for each row execute function public.touch_updated_at();

-- Payout option changes are admin config changes (§2.5). Activating a coin is
-- a decision with financial consequences and belongs in the trail.
create trigger payout_coins_audit         after insert or update or delete on public.payout_coins         for each row execute function public.audit_row_change('id');
create trigger payout_coin_networks_audit after insert or update or delete on public.payout_coin_networks for each row execute function public.audit_row_change('id');
create trigger payout_providers_audit     after insert or update or delete on public.payout_providers     for each row execute function public.audit_row_change('id');


-- ---------------------------------------------------------------------------
-- set_payout_details — the only supported write path
-- ---------------------------------------------------------------------------
--
-- Validates against the selected entry's own patterns, records a masked
-- change, and raises the fraud signal. Doing this in one function means a
-- validation rule cannot be skipped by writing the table directly, which is
-- also why the table has no client write policy.

create or replace function public.set_payout_details(
  p_user_id        uuid,
  p_method         public.payout_method,
  p_coin_id        uuid default null,
  p_network_id     uuid default null,
  p_wallet_address text default null,
  p_provider_id    uuid default null,
  p_msisdn         text default null,
  p_account_name   text default null,
  p_ip             inet default null
)
returns public.user_payout_details
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_coin     public.payout_coins;
  v_network  public.payout_coin_networks;
  v_provider public.payout_providers;
  v_pattern  text;
  v_old      public.user_payout_details;
  v_new      public.user_payout_details;
  v_old_mask text;
  v_new_mask text;
begin
  select * into v_old from public.user_payout_details
   where user_id = p_user_id and method = p_method;

  if p_method = 'crypto' then
    select * into v_coin from public.payout_coins where id = p_coin_id;
    if not found or not v_coin.is_active then
      raise exception 'Selected coin is not available' using errcode = 'check_violation';
    end if;

    -- Network requirement is read from the coin, never inferred (§6.4.1).
    if v_coin.requires_network then
      if p_network_id is null then
        raise exception 'A network must be selected for %', v_coin.code using errcode = 'check_violation';
      end if;
      select * into v_network from public.payout_coin_networks
       where id = p_network_id and coin_id = p_coin_id;
      if not found or not v_network.is_active then
        raise exception 'Selected network is not available for %', v_coin.code using errcode = 'check_violation';
      end if;
      v_pattern := v_network.address_pattern;
    else
      if p_network_id is not null then
        raise exception '% does not take a network', v_coin.code using errcode = 'check_violation';
      end if;
      v_pattern := v_coin.address_pattern;
    end if;

    if p_wallet_address is null or trim(p_wallet_address) = '' then
      raise exception 'Wallet address is required' using errcode = 'check_violation';
    end if;

    if v_pattern is not null and trim(p_wallet_address) !~ v_pattern then
      raise exception 'Wallet address does not look like a valid % address',
        coalesce(v_network.code, v_coin.code) using errcode = 'check_violation';
    end if;

    v_old_mask := public.mask_payout_value(v_old.wallet_address);
    v_new_mask := public.mask_payout_value(trim(p_wallet_address));

    insert into public.user_payout_details (user_id, method, coin_id, network_id, wallet_address, last_changed_at)
    values (p_user_id, p_method, p_coin_id, p_network_id, trim(p_wallet_address), now())
    on conflict (user_id, method) do update
      set coin_id = excluded.coin_id,
          network_id = excluded.network_id,
          wallet_address = excluded.wallet_address,
          last_changed_at = now(),
          updated_at = now()
    returning * into v_new;

  else
    select * into v_provider from public.payout_providers where id = p_provider_id;
    if not found or not v_provider.is_active then
      raise exception 'Selected mobile money provider is not available' using errcode = 'check_violation';
    end if;

    if p_msisdn is null or trim(p_msisdn) = '' then
      raise exception 'Mobile money number is required' using errcode = 'check_violation';
    end if;

    if replace(trim(p_msisdn), ' ', '') !~ v_provider.number_pattern then
      raise exception 'That number does not look like a valid % number', v_provider.name
        using errcode = 'check_violation';
    end if;

    if p_account_name is null or length(trim(p_account_name)) < 2 then
      raise exception 'The name registered on the mobile money account is required'
        using errcode = 'check_violation';
    end if;

    v_old_mask := public.mask_payout_value(v_old.msisdn);
    v_new_mask := public.mask_payout_value(replace(trim(p_msisdn), ' ', ''));

    insert into public.user_payout_details (user_id, method, provider_id, msisdn, account_name, last_changed_at)
    values (p_user_id, p_method, p_provider_id, replace(trim(p_msisdn), ' ', ''), trim(p_account_name), now())
    on conflict (user_id, method) do update
      set provider_id = excluded.provider_id,
          msisdn = excluded.msisdn,
          account_name = excluded.account_name,
          last_changed_at = now(),
          updated_at = now()
    returning * into v_new;
  end if;

  -- Only record a change when something actually changed. Re-saving the same
  -- details should not trip a fraud signal or restart the cool-off.
  if v_old.user_id is null or v_old_mask is distinct from v_new_mask then
    insert into public.payout_detail_changes (user_id, method, old_masked, new_masked, ip)
    values (p_user_id, p_method, v_old_mask, v_new_mask, p_ip);

    -- First-time setup is not suspicious; changing an existing destination is.
    if v_old.user_id is not null then
      perform public.record_fraud_signal(p_user_id, 'payout_details_changed_recently',
        jsonb_build_object('method', p_method, 'from', v_old_mask, 'to', v_new_mask));
    end if;
  end if;

  return v_new;
end;
$$;

revoke execute on function public.set_payout_details(uuid, public.payout_method, uuid, uuid, text, uuid, text, text, inet)
  from public, anon, authenticated;


-- ============================================================================
-- Row Level Security
-- ============================================================================

alter table public.payout_coins          enable row level security;
alter table public.payout_coin_networks  enable row level security;
alter table public.payout_providers      enable row level security;
alter table public.user_payout_details   enable row level security;
alter table public.payout_detail_changes enable row level security;

-- Option lists: users see active entries so they can choose; admins see all.
create policy "Read active coins, or all as admin"
  on public.payout_coins for select to anon, authenticated
  using (is_active or public.is_admin());
create policy "Admins write coins" on public.payout_coins for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy "Read active networks, or all as admin"
  on public.payout_coin_networks for select to anon, authenticated
  using (is_active or public.is_admin());
create policy "Admins write networks" on public.payout_coin_networks for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy "Read active providers, or all as admin"
  on public.payout_providers for select to anon, authenticated
  using (is_active or public.is_admin());
create policy "Admins write providers" on public.payout_providers for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Payout details: owner and admin read only. No write policy — writes go
-- through set_payout_details so validation cannot be bypassed.
create policy "Read own payout details or all as admin"
  on public.user_payout_details for select to authenticated
  using ((select auth.uid()) = user_id or public.is_admin());

-- Change history is a fraud-review artefact, not something a user needs.
create policy "Admins read payout changes"
  on public.payout_detail_changes for select to authenticated
  using (public.is_admin());


-- ============================================================================
-- Seed — stablecoins only, nothing active
--
-- Operator decision at kickoff: stablecoins at launch, because a user who
-- loses 15% between requesting and receiving blames the platform, not the
-- market.
--
-- Everything seeds with rail_confirmed = false and is_active = false. Nothing
-- is selectable until someone has confirmed with the actual gateway and
-- Korapay that these rails work. That is the §6.4.1 guard doing its job on day
-- one rather than being discovered later.
-- ============================================================================

insert into public.payout_coins (code, name, requires_network, address_pattern, sort_order, rail_notes) values
  ('USDT', 'Tether USD', true, null, 0,
   'Confirm the crypto gateway supports each network before activating.'),
  ('USDC', 'USD Coin',   true, null, 1,
   'Confirm the crypto gateway supports each network before activating.');

insert into public.payout_coin_networks (coin_id, code, name, address_pattern, sort_order, rail_notes)
select c.id, n.code, n.name, n.pattern, n.ord,
       'Unconfirmed. Verify the gateway can send ' || c.code || ' on ' || n.code || ' before activating.'
from public.payout_coins c
join (values
  ('USDT', 'TRC20', 'Tron (TRC20)',     '^T[1-9A-HJ-NP-Za-km-z]{33}$', 0),
  ('USDT', 'ERC20', 'Ethereum (ERC20)', '^0x[a-fA-F0-9]{40}$',         1),
  ('USDC', 'ERC20', 'Ethereum (ERC20)', '^0x[a-fA-F0-9]{40}$',         0),
  ('USDC', 'TRC20', 'Tron (TRC20)',     '^T[1-9A-HJ-NP-Za-km-z]{33}$', 1)
) as n(coin, code, name, pattern, ord) on n.coin = c.code;

-- Ghanaian mobile money. Prefixes are allocated per network, so each provider
-- validates its own — catching a wrong-provider selection here rather than at
-- Korapay after the user has waited out the holding period.
insert into public.payout_providers (code, name, number_pattern, sort_order, rail_notes) values
  ('MTN_MOMO',   'MTN Mobile Money',  '^(\+233|0)(24|54|55|59)[0-9]{7}$',       0,
   'Confirm Korapay payout support before activating.'),
  ('TELECEL',    'Telecel Cash',      '^(\+233|0)(20|50)[0-9]{7}$',             1,
   'Confirm Korapay payout support before activating. Formerly Vodafone Cash.'),
  ('AIRTELTIGO', 'AirtelTigo Money',  '^(\+233|0)(26|27|56|57)[0-9]{7}$',       2,
   'Confirm Korapay payout support before activating.');
