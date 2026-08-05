-- ============================================================================
-- Migration 112 — PHASE 2, step 5 of 7: tracking links, clicks and attribution
--
-- Who gets the credit for a sale, decided once, at the moment the sale
-- happens, and written down in enough detail to answer an argument a year
-- later. No money moves here — that is step 6. What this step produces is a
-- CONVERSION: the record of who earned, at what rate, on what base, and why.
--
-- ---------------------------------------------------------------------------
-- THE THREE THINGS THIS IS BUILT AROUND
--
-- C22 — LEVEL TWO IS RESOLVED AT CONVERSION TIME. The upline's entitlement is
-- checked at the instant of the sale and the answer is STORED on the
-- conversion. Never re-derived later from entitlement history, which by then
-- has moved. This is why the conversion row is wide.
--
-- C18 — LAST CLICK WINS, inside a 30-day window, per program.
--
-- SELF-REFERRAL IS BLOCKED. An affiliate earns nothing on their own purchase,
-- checked by user id. Without it, buying your own training through your own
-- link pays you a commission on your own entry fee, which is both an obvious
-- exploit and the worst possible shape given the C16 decision.
-- ============================================================================

do $$ begin
  create type public.conversion_status as enum ('attributed', 'reversed');
exception when duplicate_object then null; end $$;


-- ---------------------------------------------------------------------------
-- 1. The commission arrangement for a product
-- ---------------------------------------------------------------------------
--
-- A5: one program per product. C13: every product carries its own rates.
--
-- C14 is percentage-only, but the TYPE is stored anyway. It costs nothing now
-- and means adding fixed-amount commissions later is a config change rather
-- than a migration through money code — the brief warned that retrofitting
-- `fixed` touches the calculation, and this sidesteps it without building
-- anything the Owner did not ask for.

create table if not exists public.affiliate_programs (
  id         uuid primary key default gen_random_uuid(),
  product_id uuid not null unique references public.products(id) on delete cascade,

  l1_rate_type  text not null default 'percent',
  l1_rate_value numeric(6,3) not null,
  l2_rate_type  text not null default 'percent',
  l2_rate_value numeric(6,3) not null default 0,

  attribution_window_hours int not null default 720,   -- C18: 30 days
  hold_days                int not null default 0,     -- C19: none, mechanism kept

  status     text not null default 'active',           -- active | paused
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint affiliate_programs_rate_types check (l1_rate_type = 'percent' and l2_rate_type = 'percent'),
  constraint affiliate_programs_l1_sane    check (l1_rate_value >= 0 and l1_rate_value <= 100),
  constraint affiliate_programs_l2_sane    check (l2_rate_value >= 0 and l2_rate_value <= 100),

  /* THE TWO LEVELS TOGETHER CAN NEVER EXCEED THE SALE. Refused here rather
     than clamped later: a clamp hides a misconfiguration until somebody reads
     a report, and a rate pair that would pay out 120% of a sale is always a
     mistake rather than a promotion. */
  constraint affiliate_programs_together_sane check (l1_rate_value + l2_rate_value <= 100),

  constraint affiliate_programs_window_sane check (attribution_window_hours > 0),
  constraint affiliate_programs_hold_sane   check (hold_days >= 0)
);

drop trigger if exists affiliate_programs_touch_updated_at on public.affiliate_programs;
create trigger affiliate_programs_touch_updated_at
  before update on public.affiliate_programs
  for each row execute function public.touch_updated_at();

alter table public.affiliate_programs enable row level security;

/* An affiliate deciding what to promote needs to see the rate. Only for a
   published product, and only the rates — there is nothing else here. */
create policy affiliate_programs_readable on public.affiliate_programs
  for select to authenticated
  using (
    exists (select 1 from public.products p
             where p.id = affiliate_programs.product_id and p.status = 'published')
  );


-- ---------------------------------------------------------------------------
-- 2. Clicks
-- ---------------------------------------------------------------------------
--
-- Recorded server-side when somebody follows a tracking link.
--
-- BOUND TWO WAYS ON PURPOSE (brief §4.2). `visitor_token` is the first-party
-- cookie and works before anybody signs in; `user_id` is filled in the moment
-- they are known. Attribution matches on EITHER, so a click that happened
-- logged-out still counts after they log in to buy, and a cookie cleared
-- between click and purchase does not lose the credit if the same account was
-- signed in.

create table if not exists public.affiliate_clicks (
  id            uuid primary key default gen_random_uuid(),
  affiliate_id  uuid not null references public.affiliate_accounts(id) on delete cascade,
  product_id    uuid not null references public.products(id) on delete cascade,
  subid         text,
  visitor_token text,
  user_id       uuid references auth.users(id) on delete set null,
  ip            inet,
  user_agent    text,
  fingerprint   text,
  referrer      text,
  landing_url   text,
  created_at    timestamptz not null default now()
);

/* The index attribution actually uses: newest click for this product, for
   this visitor or this user. */
create index if not exists affiliate_clicks_attribution_idx
  on public.affiliate_clicks (product_id, created_at desc);
create index if not exists affiliate_clicks_visitor_idx
  on public.affiliate_clicks (visitor_token, created_at desc) where visitor_token is not null;
create index if not exists affiliate_clicks_user_idx
  on public.affiliate_clicks (user_id, created_at desc) where user_id is not null;
create index if not exists affiliate_clicks_affiliate_idx
  on public.affiliate_clicks (affiliate_id, created_at desc);

alter table public.affiliate_clicks enable row level security;

/* An affiliate sees their own clicks — that is the whole of their traffic
   report. Nobody sees anybody else's. */
create policy affiliate_clicks_own on public.affiliate_clicks
  for select to authenticated
  using (
    exists (select 1 from public.affiliate_accounts a
             where a.id = affiliate_clicks.affiliate_id
               and (a.user_id = (select auth.uid()) or public.is_admin()))
  );


-- ---------------------------------------------------------------------------
-- 3. Conversions
-- ---------------------------------------------------------------------------
--
-- ONE CONVERSION PER ORDER, enforced by a unique key rather than by care.
-- Everything about how the money was worked out is frozen here at the moment
-- of the sale, because all of its inputs can change afterwards: a program's
-- rates can be re-tuned tomorrow, an upline's Professional entitlement can
-- lapse next month, and the product's price can go on sale next week. What
-- somebody earned must not move when any of those do.

create table if not exists public.conversions (
  id       uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.orders(id) on delete cascade,

  affiliate_id uuid not null references public.affiliate_accounts(id),
  click_id     uuid references public.affiliate_clicks(id),
  subid        text,
  program_id   uuid not null references public.affiliate_programs(id),

  attribution_model text not null default 'last_click',
  attributed_at     timestamptz not null default now(),

  /* The rate that applied, copied. Not looked up again later. */
  l1_rate numeric(6,3) not null,

  /* C22, frozen. `l2_depth_at_conversion` is what the upline could actually
     do at that instant — 2 means they held Professional and the override is
     payable, anything else means it is not. Storing the entitlement id as
     well is what makes a dispute answerable rather than argued. */
  l2_affiliate_id        uuid references public.affiliate_accounts(id),
  l2_rate                numeric(6,3),
  l2_entitlement_id      uuid references public.affiliate_entitlements(id),
  l2_depth_at_conversion int,

  /* The commission base, decided 2026-08-05: what the buyer actually paid. */
  base_minor bigint not null,

  status     public.conversion_status not null default 'attributed',
  created_at timestamptz not null default now(),

  constraint conversions_base_sane check (base_minor >= 0),
  constraint conversions_l1_not_self check (l2_affiliate_id is null or l2_affiliate_id <> affiliate_id)
);

create index if not exists conversions_affiliate_idx on public.conversions (affiliate_id, attributed_at desc);
create index if not exists conversions_l2_idx on public.conversions (l2_affiliate_id, attributed_at desc)
  where l2_affiliate_id is not null;

alter table public.conversions enable row level security;

create policy conversions_own on public.conversions
  for select to authenticated
  using (
    exists (select 1 from public.affiliate_accounts a
             where a.id in (conversions.affiliate_id, conversions.l2_affiliate_id)
               and (a.user_id = (select auth.uid()) or public.is_admin()))
  );


-- ---------------------------------------------------------------------------
-- 4. Recording a click
-- ---------------------------------------------------------------------------
--
-- Refuses a click that could never earn, so a broken link fails loudly at the
-- moment it is shared rather than silently at the moment somebody buys.

create or replace function public.record_affiliate_click(
  p_affiliate_code text,
  p_product_id uuid,
  p_subid text default null,
  p_visitor_token text default null,
  p_user_id uuid default null,
  p_ip inet default null,
  p_user_agent text default null,
  p_fingerprint text default null,
  p_referrer text default null,
  p_landing_url text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account public.affiliate_accounts;
  v_product public.products;
  v_needed  int;
  v_id      uuid;
begin
  select * into v_account from public.affiliate_accounts where affiliate_code = p_affiliate_code;
  if not found then
    raise exception 'Unknown affiliate link' using errcode = 'check_violation';
  end if;

  select * into v_product from public.products where id = p_product_id;
  if not found or v_product.status <> 'published' then
    raise exception 'That product is not on sale' using errcode = 'check_violation';
  end if;

  /* D23 as a MINIMUM. Beginner needs depth 1, Professional needs depth 2, and
     Professional is a superset of Beginner because the enum is ordered. */
  v_needed := case when v_product.min_affiliate_tier = 'professional' then 2 else 1 end;
  if public.affiliate_depth_now(v_account.id) < v_needed then
    raise exception 'This affiliate may not promote that product'
      using errcode = 'insufficient_privilege';
  end if;

  insert into public.affiliate_clicks
    (affiliate_id, product_id, subid, visitor_token, user_id, ip, user_agent,
     fingerprint, referrer, landing_url)
  values
    (v_account.id, p_product_id, nullif(btrim(coalesce(p_subid, '')), ''), p_visitor_token,
     p_user_id, p_ip, p_user_agent, p_fingerprint, p_referrer, p_landing_url)
  returning id into v_id;

  return v_id;
end;
$$;

revoke execute on function public.record_affiliate_click(text, uuid, text, text, uuid, inet, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.record_affiliate_click(text, uuid, text, text, uuid, inet, text, text, text, text)
  to service_role;


-- ---------------------------------------------------------------------------
-- 5. Attributing an order
-- ---------------------------------------------------------------------------

create or replace function public.attribute_order(
  p_order_id uuid,
  p_visitor_token text default null
)
returns public.conversions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order      public.orders;
  v_program    public.affiliate_programs;
  v_click      public.affiliate_clicks;
  v_buyer      public.affiliate_accounts;
  v_parent     public.affiliate_accounts;
  v_l2_depth   int;
  v_l2_ent     uuid;
  v_l2_id      uuid;
  v_l2_rate    numeric(6,3);
  v_conversion public.conversions;
begin
  select * into v_order from public.orders where id = p_order_id;
  if not found then
    raise exception 'Unknown order' using errcode = 'check_violation';
  end if;

  /* Already attributed: return what is there. A retried webhook must not make
     a second conversion, and the unique key would refuse it anyway — better to
     answer than to raise on an expected retry. */
  select * into v_conversion from public.conversions where order_id = p_order_id;
  if found then
    return v_conversion;
  end if;

  /* B11c. A RENEWAL PAYS NOBODY, AT ANY LEVEL. An override paid every year for
     a single recruitment is residual recruitment income, and the surest way to
     guarantee it never happens is for a renewal to leave here before anything
     is written. An upgrade DOES pay, on the difference charged (B8). */
  if v_order.kind = 'training_renewal' then
    return null;
  end if;

  select * into v_program from public.affiliate_programs
   where product_id = v_order.product_id and status = 'active';
  if not found then
    return null;   -- nothing pays commission on this product
  end if;

  /* LAST CLICK WINS, inside the window, matched on the visitor cookie OR the
     signed-in account. Either is enough: a logged-out click still counts once
     they sign in to buy, and a cleared cookie does not lose the credit. */
  select * into v_click
    from public.affiliate_clicks c
   where c.product_id = v_order.product_id
     and c.created_at > now() - make_interval(hours => v_program.attribution_window_hours)
     and (
       (p_visitor_token is not null and c.visitor_token = p_visitor_token)
       or c.user_id = v_order.user_id
     )
   order by c.created_at desc
   limit 1;

  if not found then
    return null;   -- an organic sale; nobody earns
  end if;

  /* SELF-REFERRAL. Buying through your own link pays nothing — and given that
     training itself pays commission (C16), buying your own entry fee through
     your own link would otherwise be a straight discount funded by the
     programme. */
  select * into v_buyer from public.affiliate_accounts where user_id = v_order.user_id;
  if found and v_buyer.id = v_click.affiliate_id then
    return null;
  end if;

  -- ---- C22: resolve level two NOW, and write down what was true ----------
  select * into v_parent from public.affiliate_accounts
   where id = (select parent_affiliate_id from public.affiliate_accounts where id = v_click.affiliate_id);

  if found and v_parent.id is not null and v_parent.id <> v_click.affiliate_id then
    v_l2_depth := public.affiliate_depth_now(v_parent.id);

    /* An override is payable only by somebody holding Professional AT THIS
       MOMENT. A lapsed upline earns nothing, which is exactly what makes the
       one-year entitlement mean something. */
    if v_l2_depth >= 2 then
      v_l2_id := v_parent.id;
      v_l2_rate := v_program.l2_rate_value;
      select id into v_l2_ent from public.affiliate_entitlements
       where affiliate_id = v_parent.id and status = 'active' and grace_ends_at > now()
       order by commission_depth desc, expires_at desc limit 1;
    end if;
  end if;

  insert into public.conversions
    (order_id, affiliate_id, click_id, subid, program_id,
     l1_rate, l2_affiliate_id, l2_rate, l2_entitlement_id, l2_depth_at_conversion,
     base_minor)
  values
    (p_order_id, v_click.affiliate_id, v_click.id, v_click.subid, v_program.id,
     v_program.l1_rate_value, v_l2_id, v_l2_rate, v_l2_ent, v_l2_depth,
     v_order.amount_minor)
  returning * into v_conversion;

  return v_conversion;
end;
$$;

revoke execute on function public.attribute_order(uuid, text) from public, anon, authenticated;
grant execute on function public.attribute_order(uuid, text) to service_role;


-- ---------------------------------------------------------------------------
-- 6. Confirming, now with attribution — and the upline finally gets set
-- ---------------------------------------------------------------------------
--
-- Replaces the version from migration 111. The order of operations inside the
-- exception block is deliberate and is the point of this revision:
--
--   grant access  →  attribute the sale  →  create the affiliate account
--
-- Attribution has to come FIRST, because whoever's link produced a training
-- sale is the new affiliate's upline. Creating the account before attributing
-- would leave `parent_affiliate_id` null and the recruitment relationship lost
-- — and it is frozen at creation, so there is no second chance to set it.

create or replace function public.confirm_product_order(
  p_order_id uuid,
  p_provider_ref text,
  p_visitor_token text default null
)
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order      public.orders;
  v_product    public.products;
  v_training   public.training_programs;
  v_account    public.affiliate_accounts;
  v_conversion public.conversions;
  v_parent     uuid;
  v_expires    timestamptz;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'Unknown order' using errcode = 'check_violation';
  end if;

  if v_order.status = 'confirmed' then
    if v_order.provider_ref is not distinct from p_provider_ref then
      return v_order;
    end if;
    raise exception 'That order was already confirmed with another reference'
      using errcode = 'check_violation';
  end if;

  if v_order.status <> 'pending' then
    raise exception 'That order is % and cannot be confirmed', v_order.status
      using errcode = 'check_violation';
  end if;

  update public.orders
     set status = 'confirmed', provider_ref = p_provider_ref, confirmed_at = now()
   where id = p_order_id
  returning * into v_order;

  begin
    perform public.grant_order_entitlements(p_order_id);

    v_conversion := public.attribute_order(p_order_id, p_visitor_token);

    select * into v_product from public.products where id = v_order.product_id;

    if v_product.purpose = 'training_program' and v_order.kind = 'purchase' then
      select * into v_training from public.training_programs where product_id = v_product.id;

      if found then
        select * into v_account from public.affiliate_accounts where user_id = v_order.user_id;

        if not found then
          /* The upline, frozen at creation. Null when the sale was organic,
             which is correct — nobody recruited them. */
          v_parent := case
                        when v_conversion.id is not null then v_conversion.affiliate_id
                        else null
                      end;

          insert into public.affiliate_accounts (user_id, affiliate_code, status, parent_affiliate_id)
          values (v_order.user_id, public.generate_affiliate_code(), 'pending', v_parent)
          returning * into v_account;
        end if;

        v_expires := v_order.confirmed_at + make_interval(days => v_training.validity_days);

        insert into public.affiliate_entitlements
          (affiliate_id, training_program_id, order_id, commission_depth,
           starts_at, expires_at, grace_ends_at, status)
        values
          (v_account.id, v_training.id, v_order.id, v_training.commission_depth,
           v_order.confirmed_at, v_expires,
           v_expires + make_interval(days => v_training.grace_days), 'active')
        on conflict (affiliate_id, training_program_id) do update
          set order_id         = excluded.order_id,
              commission_depth = excluded.commission_depth,
              expires_at       = greatest(public.affiliate_entitlements.expires_at, excluded.expires_at),
              grace_ends_at    = greatest(public.affiliate_entitlements.grace_ends_at, excluded.grace_ends_at),
              status           = 'active',
              updated_at       = now();

        perform public.evaluate_affiliate_activation(v_order.user_id, v_product.id);
      end if;
    end if;
  exception when others then
    insert into public.system_alerts (severity, code, message, context)
    values (
      'high', 'entitlement_grant_failed',
      'An order was paid but its access could not be granted.',
      jsonb_build_object('order_id', p_order_id, 'error', sqlerrm)
    );
  end;

  return v_order;
end;
$$;

revoke execute on function public.confirm_product_order(uuid, text, text) from public, anon, authenticated;
grant execute on function public.confirm_product_order(uuid, text, text) to service_role;

/* The two-argument form from migrations 110 and 111 is dropped: leaving it
   would mean two confirm paths, and the older one silently skips attribution.
   One way in, or somebody eventually calls the wrong one. */
drop function if exists public.confirm_product_order(uuid, text);
