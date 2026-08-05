-- ============================================================================
-- Migration 111 — PHASE 2, step 4 of 7: training, affiliate accounts, activation
--
-- Buying training is what makes somebody an affiliate. This migration builds
-- the programs, the accounts, the time-limited right to promote, and the rule
-- that decides when that right switches on.
--
-- ---------------------------------------------------------------------------
-- ⚠️ A CORRECTION TO MIGRATION 110'S OWN NOTE
--
-- Migration 110 says step 4 must "stamp `expires_at` on training grants" in
-- `entitlements`. **That is wrong and is NOT done here.** Re-reading the B11
-- decision: what expires is the RIGHT TO PROMOTE, not access to the content.
-- The operator's rule is that somebody keeps the course they paid for
-- permanently, because taking a course back from a paying customer produces
-- refund demands and reputational damage.
--
-- So there are TWO separate rows for a training purchase, and the split is the
-- whole point:
--
--   entitlements           the course itself. expires_at stays NULL. Permanent.
--   affiliate_entitlements the right to promote. One year from purchase, with
--                          a grace period, and it is this one that lapses.
--
-- Had 110's note been followed, a lapsed affiliate would have lost access to
-- training they had bought — the exact outcome the decision rules out.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Types
-- ---------------------------------------------------------------------------

do $$ begin
  create type public.affiliate_status as enum ('pending', 'active', 'suspended');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.affiliate_entitlement_status as enum ('active', 'expired', 'revoked');
exception when duplicate_object then null; end $$;


-- ---------------------------------------------------------------------------
-- 2. Training programs
-- ---------------------------------------------------------------------------
--
-- A training program IS a product (`purpose = 'training_program'`) with these
-- extra settings. Every number here is the Owner's to change from the admin —
-- none of them is a constant in code, which is the standing rule.

create table if not exists public.training_programs (
  id         uuid primary key default gen_random_uuid(),
  product_id uuid not null unique references public.products(id) on delete cascade,
  level      public.affiliate_tier not null,

  /* A NUMBER, never an `if level = 'professional'` branch anywhere in the
     code. The brief is explicit about this and it is worth honouring: depth is
     a property of what was bought, and a branch on the name is how a third
     tier later becomes a search-and-replace across the money path. */
  commission_depth int not null,

  /* B9: the share of the program that must be completed before the affiliate
     account switches on. Lessons completed / total lessons — not sections and
     not minutes, so a long lesson is not worth more than a short one. */
  activation_threshold_percent int not null default 50,

  /* B10: what counts as completing ONE lesson. Both are required. */
  lesson_pass_percent int not null default 90,
  quiz_required       bool not null default true,

  /* B11 / B11e: how long the right to promote lasts, and how long after it
     lapses somebody can still earn while they sort out a renewal. */
  validity_days int not null default 365,
  grace_days    int not null default 5,

  /* B11b: renewals are discounted against the first-time price. Null means
     renew at the product's current price. */
  renewal_price_minor bigint,

  certificate_enabled bool not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint training_depth_sane check (commission_depth in (1, 2)),
  /* Beginner unlocks one level, Professional two (brief §1.4). Enforced so the
     two fields cannot drift apart and quietly pay an override to somebody who
     bought the cheaper tier. */
  constraint training_depth_matches_level
    check ((level = 'beginner' and commission_depth = 1)
        or (level = 'professional' and commission_depth = 2)),
  constraint training_threshold_sane check (activation_threshold_percent between 0 and 100),
  constraint training_pass_sane      check (lesson_pass_percent between 1 and 100),
  constraint training_validity_sane  check (validity_days > 0),
  constraint training_grace_sane     check (grace_days >= 0),
  constraint training_renewal_sane   check (renewal_price_minor is null or renewal_price_minor >= 0)
);

drop trigger if exists training_programs_touch_updated_at on public.training_programs;
create trigger training_programs_touch_updated_at
  before update on public.training_programs
  for each row execute function public.touch_updated_at();

alter table public.training_programs enable row level security;

/* Readable by a signed-in shopper: the comparison table between Beginner and
   Professional is a sales screen, and these are the numbers on it. */
create policy training_programs_readable on public.training_programs
  for select to authenticated
  using (
    exists (select 1 from public.products p
             where p.id = training_programs.product_id and p.status = 'published')
  );

/* A training program must actually be a training product. Cheap to check, and
   it stops a vendor course accidentally granting affiliate eligibility. */
create or replace function public.training_programs_product_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_purpose public.product_purpose;
begin
  select purpose into v_purpose from public.products where id = new.product_id;
  if v_purpose is distinct from 'training_program' then
    raise exception 'Only a training_program product can have training settings'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists training_programs_product on public.training_programs;
create trigger training_programs_product
  before insert or update on public.training_programs
  for each row execute function public.training_programs_product_guard();


-- ---------------------------------------------------------------------------
-- 3. Affiliate accounts
-- ---------------------------------------------------------------------------

create table if not exists public.affiliate_accounts (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null unique references auth.users(id) on delete cascade,
  affiliate_code     text not null unique,

  /* ONE HOP. There is no ancestry column, no path, and no recursive query
     anywhere in this schema — a third level is UNEXPRESSIBLE rather than
     switched off. That is a legal property of the product, not a style
     choice: the lawyer's clearance is for two levels, and adding a recursive
     CTE here would change what the product is. Phase 1 holds the same
     property in `second_level_referral()`. */
  parent_affiliate_id uuid references public.affiliate_accounts(id),

  status             public.affiliate_status not null default 'pending',

  /* B9: set once, never recomputed downward. Publishing new lessons lowers
     everybody's completion percentage, and an affiliate who already qualified
     must not be deactivated by an edit to the curriculum. */
  activated_at       timestamptz,

  /* H47: the Owner is not drafting terms yet, but the MECHANISM ships now —
     it cannot be added retroactively for people who have already joined. */
  terms_version      int,
  terms_accepted_at  timestamptz,

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  constraint affiliate_not_own_parent check (parent_affiliate_id is null or parent_affiliate_id <> id),
  constraint affiliate_active_has_time
    check (status <> 'active' or activated_at is not null)
);

create index if not exists affiliate_accounts_parent_idx
  on public.affiliate_accounts (parent_affiliate_id) where parent_affiliate_id is not null;

drop trigger if exists affiliate_accounts_touch_updated_at on public.affiliate_accounts;
create trigger affiliate_accounts_touch_updated_at
  before update on public.affiliate_accounts
  for each row execute function public.touch_updated_at();

alter table public.affiliate_accounts enable row level security;

create policy affiliate_accounts_own on public.affiliate_accounts
  for select to authenticated
  using (user_id = (select auth.uid()) or public.is_admin());

/*
  NO CYCLES. Reachable in practice: A recruits B, and later B's link is the one
  that sells A their training. Without this, A becomes their own second-level
  affiliate and pays themselves an override forever. Phase 1 hit exactly this
  shape when referrals went two-deep.

  With one hop the whole check is two comparisons — there is no chain to walk,
  which is precisely the benefit of refusing to store one.
*/
create or replace function public.affiliate_parent_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_parents_parent uuid;
begin
  if new.parent_affiliate_id is null then
    return new;
  end if;

  if new.parent_affiliate_id = new.id then
    raise exception 'An affiliate cannot be their own upline' using errcode = 'check_violation';
  end if;

  select parent_affiliate_id into v_parents_parent
    from public.affiliate_accounts where id = new.parent_affiliate_id;

  if v_parents_parent = new.id then
    raise exception 'That would make two affiliates each other''s upline'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists affiliate_accounts_parent on public.affiliate_accounts;
create trigger affiliate_accounts_parent
  before insert or update on public.affiliate_accounts
  for each row execute function public.affiliate_parent_guard();


-- ---------------------------------------------------------------------------
-- 4. The right to promote
-- ---------------------------------------------------------------------------
--
-- Separate from the content entitlement, for the reason at the top of this
-- file: the course is permanent, this is not.

create table if not exists public.affiliate_entitlements (
  id                  uuid primary key default gen_random_uuid(),
  affiliate_id        uuid not null references public.affiliate_accounts(id) on delete cascade,
  training_program_id uuid not null references public.training_programs(id),
  order_id            uuid not null references public.orders(id),
  commission_depth    int not null,

  /* B11a: the year runs from PURCHASE, not from activation. Activation-dated
     would let somebody park an unstarted entitlement indefinitely. */
  starts_at    timestamptz not null,
  expires_at   timestamptz not null,
  grace_ends_at timestamptz not null,

  status public.affiliate_entitlement_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (affiliate_id, training_program_id),
  constraint affiliate_entitlement_depth_sane check (commission_depth in (1, 2)),
  constraint affiliate_entitlement_dates_ordered
    check (expires_at > starts_at and grace_ends_at >= expires_at)
);

create index if not exists affiliate_entitlements_expiring_idx
  on public.affiliate_entitlements (grace_ends_at) where status = 'active';

drop trigger if exists affiliate_entitlements_touch_updated_at on public.affiliate_entitlements;
create trigger affiliate_entitlements_touch_updated_at
  before update on public.affiliate_entitlements
  for each row execute function public.touch_updated_at();

alter table public.affiliate_entitlements enable row level security;

create policy affiliate_entitlements_own on public.affiliate_entitlements
  for select to authenticated
  using (
    exists (select 1 from public.affiliate_accounts a
             where a.id = affiliate_entitlements.affiliate_id
               and (a.user_id = (select auth.uid()) or public.is_admin()))
  );


-- ---------------------------------------------------------------------------
-- 5. What somebody may do right now
-- ---------------------------------------------------------------------------
--
-- The single question every commission calculation will ask, and C22 says it
-- is asked AT THE MOMENT OF THE SALE rather than read from something cached.
-- Returning the DEPTH rather than a boolean is what lets step 6 resolve a
-- level-2 override without a second query and without a branch on tier names.
--
-- Zero means "may not promote": no account, not active, suspended, or every
-- entitlement past its grace.

create or replace function public.affiliate_depth_now(p_affiliate_id uuid)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select max(e.commission_depth)
       from public.affiliate_entitlements e
       join public.affiliate_accounts a on a.id = e.affiliate_id
      where e.affiliate_id = p_affiliate_id
        and e.status = 'active'
        and a.status = 'active'
        and e.grace_ends_at > now()),
    0);
$$;

comment on function public.affiliate_depth_now(uuid) is
  'How many commission levels this affiliate may earn RIGHT NOW: 0 none, 1 own sales, 2 own sales plus an override. Resolved at conversion time (C22), never cached.';

revoke execute on function public.affiliate_depth_now(uuid) from public, anon, authenticated;
grant execute on function public.affiliate_depth_now(uuid) to service_role;


-- ---------------------------------------------------------------------------
-- 6. Completion, and the moment somebody becomes an affiliate
-- ---------------------------------------------------------------------------

create or replace function public.training_completion_percent(
  p_user_id uuid,
  p_product_id uuid
)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  with settings as (
    select coalesce(tp.lesson_pass_percent, 90) as pass_percent,
           coalesce(tp.quiz_required, false)    as quiz_required
      from public.training_programs tp
     where tp.product_id = p_product_id
  ),
  all_lessons as (
    select l.id
      from public.lessons l
      join public.course_sections s on s.id = l.section_id
     where s.product_id = p_product_id
  ),
  done as (
    select lp.lesson_id
      from public.lesson_progress lp
      join all_lessons al on al.id = lp.lesson_id
     cross join settings st
     where lp.watched_percent >= st.pass_percent
       and (not st.quiz_required or lp.quiz_passed)
       and lp.user_id = p_user_id
  )
  select case
           when (select count(*) from all_lessons) = 0 then 0
           else floor(
             (select count(*) from done)::numeric * 100
             / (select count(*) from all_lessons)
           )::int
         end;
$$;

comment on function public.training_completion_percent(uuid, uuid) is
  'Share of a program completed, as LESSONS DONE / TOTAL LESSONS. Not sections, not minutes — a long lesson is not worth more than a short one.';

revoke execute on function public.training_completion_percent(uuid, uuid) from public, anon;
grant execute on function public.training_completion_percent(uuid, uuid) to authenticated, service_role;


/*
  ACTIVATION IS A ONE-WAY FLIP.

  Called whenever a lesson is completed. It can only ever switch an account ON.
  Publishing a new module lowers everybody's completion percentage, and without
  this an affiliate who qualified last week would silently lose the right to
  earn because the Owner added a lesson. `activated_at` is the record that it
  already happened.
*/
create or replace function public.evaluate_affiliate_activation(
  p_user_id uuid,
  p_product_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_threshold int;
  v_percent   int;
  v_account   public.affiliate_accounts;
  v_email     text;
begin
  select activation_threshold_percent into v_threshold
    from public.training_programs where product_id = p_product_id;
  if not found then
    return false;   -- not a training program; nothing to activate
  end if;

  select * into v_account from public.affiliate_accounts where user_id = p_user_id;
  if not found then
    return false;
  end if;

  if v_account.status = 'active' then
    return true;    -- already on; never recomputed downward
  end if;

  if v_account.status = 'suspended' then
    return false;   -- a suspension is a decision, not something completion undoes
  end if;

  v_percent := public.training_completion_percent(p_user_id, p_product_id);
  if v_percent < v_threshold then
    return false;
  end if;

  update public.affiliate_accounts
     set status = 'active', activated_at = now()
   where id = v_account.id;

  /* Activation is the moment somebody gains the ability to earn money, so it
     belongs in the audit trail like any money event. */
  select u.email::text into v_email from auth.users u where u.id = p_user_id;
  insert into public.admin_audit_log
    (actor_id, actor_email, action, entity_type, entity_id, new_values)
  values (
    p_user_id, v_email, 'affiliate_activated', 'affiliate_accounts', v_account.id,
    jsonb_build_object('product_id', p_product_id, 'completion_percent', v_percent,
                       'threshold', v_threshold)
  );

  return true;
end;
$$;

revoke execute on function public.evaluate_affiliate_activation(uuid, uuid) from public, anon, authenticated;
grant execute on function public.evaluate_affiliate_activation(uuid, uuid) to service_role;


/* The entry point the player calls. Progress only ever moves FORWARD — a
   rewatch must not reduce a completed lesson, or scrubbing backwards would
   un-complete it and, at the threshold, un-make an affiliate. */
create or replace function public.record_lesson_progress(
  p_user_id uuid,
  p_lesson_id uuid,
  p_seconds int,
  p_percent int,
  p_quiz_passed bool default null
)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product_id uuid;
  v_pass       int;
  v_quiz_req   bool;
  v_row        public.lesson_progress;
begin
  select s.product_id into v_product_id
    from public.lessons l join public.course_sections s on s.id = l.section_id
   where l.id = p_lesson_id;

  if v_product_id is null then
    raise exception 'Unknown lesson' using errcode = 'check_violation';
  end if;

  insert into public.lesson_progress (user_id, lesson_id, seconds_watched, watched_percent, quiz_passed)
  values (p_user_id, p_lesson_id, greatest(p_seconds, 0), least(greatest(p_percent, 0), 100),
          coalesce(p_quiz_passed, false))
  on conflict (user_id, lesson_id) do update
    set seconds_watched = greatest(public.lesson_progress.seconds_watched, excluded.seconds_watched),
        watched_percent = greatest(public.lesson_progress.watched_percent, excluded.watched_percent),
        quiz_passed     = public.lesson_progress.quiz_passed or excluded.quiz_passed,
        updated_at      = now()
  returning * into v_row;

  select coalesce(tp.lesson_pass_percent, 90), coalesce(tp.quiz_required, false)
    into v_pass, v_quiz_req
    from public.training_programs tp where tp.product_id = v_product_id;

  if v_row.completed_at is null
     and v_row.watched_percent >= coalesce(v_pass, 90)
     and (not coalesce(v_quiz_req, false) or v_row.quiz_passed) then
    update public.lesson_progress set completed_at = now()
     where user_id = p_user_id and lesson_id = p_lesson_id;
  end if;

  perform public.evaluate_affiliate_activation(p_user_id, v_product_id);

  return public.training_completion_percent(p_user_id, v_product_id);
end;
$$;

revoke execute on function public.record_lesson_progress(uuid, uuid, int, int, bool)
  from public, anon, authenticated;
grant execute on function public.record_lesson_progress(uuid, uuid, int, int, bool) to service_role;


-- ---------------------------------------------------------------------------
-- 7. Affiliate codes
-- ---------------------------------------------------------------------------
--
-- From `gen_random_bytes`, not `random()`. Postgres's `random()` is a seeded
-- deterministic PRNG; this code is what a tracking link is built from, and a
-- guessable one lets somebody enumerate other people's links. Same reasoning
-- as gift codes in migration 065.

create or replace function public.generate_affiliate_code()
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_alphabet constant text := '23456789ABCDEFGHJKMNPQRSTVWXYZ';
  v_code text;
  v_byte int;
begin
  loop
    v_code := '';
    for i in 1..8 loop
      v_byte := get_byte(extensions.gen_random_bytes(1), 0);
      v_code := v_code || substr(v_alphabet, (v_byte % length(v_alphabet)) + 1, 1);
    end loop;
    exit when not exists (
      select 1 from public.affiliate_accounts where affiliate_code = v_code
    );
  end loop;
  return v_code;
end;
$$;

revoke execute on function public.generate_affiliate_code() from public, anon, authenticated;
grant execute on function public.generate_affiliate_code() to service_role;


-- ---------------------------------------------------------------------------
-- 8. Buying training makes somebody an affiliate
-- ---------------------------------------------------------------------------
--
-- Replaces `confirm_product_order` from migration 110 to add the training
-- half. Everything else about it is unchanged, including the two properties
-- that matter most: it is idempotent on the same provider reference, and a
-- failure to grant can never roll back a payment that has already arrived.
--
-- ⚠️ NOTE THE ORDER KIND. Only `purchase` creates an affiliate entitlement
-- from scratch. A `training_renewal` EXTENDS one and a `training_upgrade`
-- replaces its depth — and neither may ever create a conversion or pay
-- commission (B11c). Keeping them out of this branch is the structural reason
-- a renewal cannot accidentally pay residual recruitment income.

create or replace function public.confirm_product_order(
  p_order_id uuid,
  p_provider_ref text
)
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order    public.orders;
  v_product  public.products;
  v_training public.training_programs;
  v_account  public.affiliate_accounts;
  v_expires  timestamptz;
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

    select * into v_product from public.products where id = v_order.product_id;

    if v_product.purpose = 'training_program' and v_order.kind = 'purchase' then
      select * into v_training from public.training_programs where product_id = v_product.id;

      if found then
        /* The affiliate account. `pending` until they complete the Owner's
           threshold (B9) — buying is not activating. The upline is left null
           here; step 5 sets it from the conversion that produced the sale, and
           it is frozen at that moment. */
        select * into v_account from public.affiliate_accounts where user_id = v_order.user_id;
        if not found then
          insert into public.affiliate_accounts (user_id, affiliate_code, status)
          values (v_order.user_id, public.generate_affiliate_code(), 'pending')
          returning * into v_account;
        end if;

        /* B11a: the year runs from the moment they paid. */
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

        /* Buying may already satisfy the threshold — a program with a 0%
           threshold activates on purchase, which is a configuration the Owner
           is allowed to choose. */
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

revoke execute on function public.confirm_product_order(uuid, text) from public, anon, authenticated;
grant execute on function public.confirm_product_order(uuid, text) to service_role;
