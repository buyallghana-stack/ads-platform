-- ============================================================================
-- Migration 062 — real exchange rates for crypto payouts
--
-- WHAT WAS WRONG
-- `WithdrawWizard` carried `const DEMO_GHS_PER_USD = 10.45` and divided by it
-- to show somebody what their crypto withdrawal was worth in dollars. Both
-- rate providers put the real figure at 11.68 on the day this was written, so
-- the screen was overstating the payout by about 12% — in the direction that
-- promises more than the platform will send. A GHS 100 withdrawal displayed
-- $9.57 against an actual $8.56.
--
-- That constant has sat there since the wizard was a demo that wrote nothing.
-- It is not a demo any more: payouts_enabled is true.
--
-- WHY RATES LIVE IN A TABLE AND NOT IN A FUNCTION CALL
-- Postgres cannot make an HTTP request without an extension, and putting a
-- network call on the redemption path would be worse anyway: a provider being
-- slow would make withdrawals slow, and a provider being down would make them
-- fail. A cron writes rates here; everything else reads what was last written
-- and checks how old it is.
--
-- THE TWO HOPS, AND WHY IT IS TWO
-- No free provider quotes crypto directly into cedis — CoinGecko supports 63
-- fiat currencies and GHS is not among them (§ kickoff). So coin→USD from a
-- crypto source, USD→GHS from a fiat source, multiplied. Both legs are stored
-- separately because they come from different places, move at different
-- speeds, and go stale independently.
--
-- IT FAILS CLOSED
-- `quote_crypto_payout` returns null when either leg is missing or older than
-- `fx_rate_max_age_hours`. A quote nobody can vouch for must not be shown as
-- if somebody could: the whole defect being fixed here is a number on screen
-- that no source stood behind.
-- ============================================================================


create table public.fx_rates (
  -- 'USD_GHS', 'USDT_USD', 'USDC_USD'. Base and quote in one key because
  -- every read is for a specific named pair; splitting them into two columns
  -- would buy a composite key and no query anybody makes.
  pair text primary key check (pair ~ '^[A-Z0-9]{2,12}_[A-Z0-9]{2,12}$'),

  rate numeric(20, 10) not null check (rate > 0),

  -- Which provider actually answered. The fallbacks exist precisely because
  -- the primary sometimes does not, and "which one did we believe" is the
  -- first question when a rate looks wrong.
  source text not null,

  -- When the PROVIDER's figure was fetched, not when the row was touched. A
  -- refresh that re-writes the same number still moves this, because what
  -- matters is that somebody confirmed it recently.
  fetched_at timestamptz not null default now(),

  updated_at timestamptz not null default now()
);

comment on table public.fx_rates is
  'Last known exchange rate per pair, written by the refresh-fx cron and read by quote_crypto_payout. Never computed here — this is a cache of what an external provider said, with its age attached so a stale figure can be refused rather than shown.';

create trigger fx_rates_touch_updated_at
  before update on public.fx_rates
  for each row execute function public.touch_updated_at();


insert into public.app_config
  (key, value, value_type, min_value, max_value, is_public, description)
values
  ('fx_rate_max_age_hours', '36', 'int', 1, 720, false,
   'How old an exchange rate may be and still be used to quote a crypto payout. Beyond this no estimate is shown at all. The fiat leg only updates once a day, so 24 would make every rate stale the moment a refresh ran late; 36 absorbs one missed cycle and still refuses a genuinely old figure.'),

  ('crypto_payout_spread_percent', '0', 'decimal', 0, 10, false,
   'A margin subtracted from the quoted crypto amount to absorb movement between the estimate and the actual disbursement. Zero by default: the estimate is already labelled indicative and the final amount is computed at disbursement, so a hidden margin would be taking a cut nobody was told about. Set it only if real settlement losses show up.')
on conflict (key) do nothing;


-- ---------------------------------------------------------------------------
-- fx_rate — one leg, or null if it cannot be trusted
-- ---------------------------------------------------------------------------

create or replace function public.fx_rate(p_pair text)
returns numeric
language sql
stable
set search_path = ''
as $$
  select r.rate
    from public.fx_rates r
   where r.pair = p_pair
     and r.fetched_at > now() - make_interval(
           hours => coalesce((select value::int from public.app_config
                               where key = 'fx_rate_max_age_hours'), 36))
$$;

comment on function public.fx_rate(text) is
  'The stored rate for a pair, or null when it is missing or older than fx_rate_max_age_hours. Null means "no answer", never "zero".';


-- ---------------------------------------------------------------------------
-- quote_crypto_payout — both hops, or nothing
-- ---------------------------------------------------------------------------

create or replace function public.quote_crypto_payout(p_ghs numeric, p_coin text)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_usd_ghs  numeric;
  v_coin_usd numeric;
  v_spread   numeric;
  v_usd      numeric;
  v_coin     numeric;
  v_at       timestamptz;
begin
  if p_ghs is null or p_ghs <= 0 or p_coin is null then
    return null;
  end if;

  v_usd_ghs  := public.fx_rate('USD_GHS');
  v_coin_usd := public.fx_rate(upper(p_coin) || '_USD');

  -- Either leg unavailable means no quote at all. Falling back to "assume a
  -- stablecoin is worth exactly a dollar" would be the same class of mistake
  -- as the hardcoded rate this migration exists to remove.
  if v_usd_ghs is null or v_coin_usd is null then
    return null;
  end if;

  v_spread := coalesce(public.config_decimal('crypto_payout_spread_percent'), 0);

  v_usd  := p_ghs / v_usd_ghs;
  v_coin := (v_usd / v_coin_usd) * (1 - v_spread / 100.0);

  if v_coin <= 0 then
    return null;
  end if;

  -- The older of the two legs: a quote is only as fresh as its staler half,
  -- and reporting the newer one would overstate how current it is.
  select min(r.fetched_at) into v_at from public.fx_rates r
   where r.pair in ('USD_GHS', upper(p_coin) || '_USD');

  return jsonb_build_object(
    'coin',        upper(p_coin),
    'coin_amount', round(v_coin, 6),
    'usd_amount',  round(v_usd, 2),
    'usd_ghs',     v_usd_ghs,
    'coin_usd',    v_coin_usd,
    'spread_pct',  v_spread,
    'quoted_at',   v_at
  );
end;
$$;

comment on function public.quote_crypto_payout(numeric, text) is
  'Indicative crypto amount for a cedi value, via USD. Null when either leg is missing or stale — the caller must show nothing rather than invent a figure.';

grant execute on function public.quote_crypto_payout(numeric, text) to authenticated;


-- ---------------------------------------------------------------------------
-- admin_set_fx_rate — the only write path
-- ---------------------------------------------------------------------------
--
-- Called by the refresh cron through the service client. A function rather
-- than a table grant for the same reason `admin_set_config` is one: this is
-- the number that decides what a withdrawal is worth, and an UPSERT reachable
-- from anywhere with a key is one bad statement away from repricing every
-- pending payout.

create or replace function public.set_fx_rate(
  p_pair   text,
  p_rate   numeric,
  p_source text
)
returns public.fx_rates
language plpgsql
security definer
set search_path = ''
as $$
declare v_row public.fx_rates;
begin
  if p_rate is null or p_rate <= 0 or not (p_rate < 'infinity'::numeric) then
    raise exception 'A rate must be a positive finite number, got %', p_rate
      using errcode = 'check_violation';
  end if;

  insert into public.fx_rates (pair, rate, source, fetched_at)
  values (upper(p_pair), p_rate, p_source, now())
  on conflict (pair) do update
    set rate = excluded.rate,
        source = excluded.source,
        fetched_at = excluded.fetched_at
  returning * into v_row;

  return v_row;
end;
$$;

revoke execute on function public.set_fx_rate(text, numeric, text)
  from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
--
-- Readable by anyone signed in: the withdraw screen shows the rate it used,
-- and a rate the user cannot see is a rate they cannot check. Writable by
-- nobody — set_fx_rate is the only path and it runs as the service role.

alter table public.fx_rates enable row level security;

create policy "Anyone signed in may read exchange rates"
  on public.fx_rates for select
  to authenticated
  using (true);
