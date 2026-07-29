-- ============================================================================
-- Migration 055 — advertisers, and the money they actually pay
--
-- The Advertisers screen has had NO backend of any kind: no table, no
-- functions, nothing. `ads.advertiser_name` is a free-text reporting label
-- (migration 004 says so explicitly) and that is all there has ever been.
--
-- That gap is not cosmetic. The Overview's "deposits" figure is defined as
-- subscriptions PLUS advertiser contracts, and Finance's statement has an
-- advertisers column — so with no advertiser payments anywhere in the
-- database, both screens have been showing invented money. Wiring them to the
-- truth means first having somewhere for the truth to live.
--
-- Four things:
--
--   advertisers           who is paying, and for how long.
--   advertiser_payments   what actually arrived. This is the deposits figure;
--                         everything else about an advertiser is context.
--   ads.advertiser_id     so "how many ads are live for this contract" is a
--                         join rather than a string comparison.
--   admin functions       list / save / delete, record and unrecord payments.
--
-- STILL NO ADVERTISER PORTAL (§1). Every row here is keyed in by an operator
-- who was paid offline. The tables are shaped for that and do not pretend
-- otherwise — there is no advertiser login, no self-serve top-up, and no
-- automatic reconciliation against a payment provider.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. Status
-- ---------------------------------------------------------------------------
--
-- `pending` is a contract agreed but not yet paid, which is exactly the state
-- an operator most needs to see: an advertiser whose ads are live but whose
-- money has not arrived. `ended` is kept rather than deleted because the
-- payments they made stay on the books.

do $$
begin
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                  where n.nspname = 'public' and t.typname = 'advertiser_status') then
    create type public.advertiser_status as enum ('pending', 'active', 'ended');
  end if;
end $$;


-- ---------------------------------------------------------------------------
-- 2. advertisers
-- ---------------------------------------------------------------------------

create table if not exists public.advertisers (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  -- One free-text contact. The operator deals with these people by phone or
  -- WhatsApp; splitting it into email/phone/name columns would mean three
  -- mostly-empty fields and an argument about which one is required.
  contact      text,
  status       public.advertiser_status not null default 'pending',
  started_at   timestamptz not null default now(),
  -- Null means open-ended. A contract with no end date is normal here.
  ends_at      timestamptz,
  notes        text,
  created_by   uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint advertisers_name_length check (length(trim(name)) between 2 and 120),
  -- A contract cannot end before it starts. Cheap, and it catches the
  -- commonest keying slip on this form.
  constraint advertisers_dates_ordered check (ends_at is null or ends_at > started_at)
);

-- Case-insensitive, so "MTN Ghana" and "MTN GHANA" cannot both exist and
-- split one advertiser's money across two rows.
create unique index if not exists advertisers_name_unique_idx
  on public.advertisers (lower(trim(name)));

comment on table public.advertisers is
  'Advertiser contracts, keyed in by an operator. There is no advertiser portal (§1) — nobody here can log in.';


-- ---------------------------------------------------------------------------
-- 3. advertiser_payments
-- ---------------------------------------------------------------------------
--
-- THIS TABLE IS THE DEPOSITS FIGURE. Not a field on `advertisers`, because a
-- single "contract value" column would have to be edited every time more
-- money arrived, and an edited number has no history: the operator could
-- never answer "when did they pay, and how much, and against what
-- reference?". Rows can be added and removed; the total is always derived.
--
-- `amount_minor` follows `subscription_payments`, the other money-IN table:
-- integer pesewas, never a float. Redemptions store major units because that
-- side of the ledger was built that way; the conversion happens once, in the
-- reporting functions, and never in application code.

create table if not exists public.advertiser_payments (
  id             uuid primary key default gen_random_uuid(),
  advertiser_id  uuid not null references public.advertisers (id) on delete cascade,
  amount_minor   bigint not null,
  currency_code  char(3) not null default 'GHS',
  -- When the money ARRIVED, which is not when it was typed in. Backdating is
  -- the normal case: an operator reconciles a week of transfers on Friday.
  received_at    timestamptz not null default now(),
  -- How it came. Free text on purpose — this is the operator's own bookkeeping
  -- vocabulary (bank, MoMo, cash, cheque) and an enum here would need a
  -- migration every time a new one appeared.
  method         text,
  -- The bank or MoMo reference. What makes the row checkable against a
  -- statement, which is the whole reason to record it rather than a total.
  reference      text,
  note           text,
  recorded_by    uuid references auth.users (id) on delete set null,
  created_at     timestamptz not null default now(),

  -- Zero is meaningless and negatives are not refunds — a refund is a
  -- decision that needs its own reasoning, not a minus sign hidden in a list
  -- of receipts. Delete the row if it was keyed wrongly.
  constraint advertiser_payments_amount_positive check (amount_minor > 0)
);

create index if not exists advertiser_payments_advertiser_idx
  on public.advertiser_payments (advertiser_id, received_at desc);

-- The statement groups by month, and the overview by day.
create index if not exists advertiser_payments_received_idx
  on public.advertiser_payments (received_at);

comment on table public.advertiser_payments is
  'Money actually received from advertisers. The deposits figure is the sum of these rows — never a stored total, so every figure can be traced to a reference on a bank statement.';


-- ---------------------------------------------------------------------------
-- 4. Link ads to advertisers
-- ---------------------------------------------------------------------------
--
-- `advertiser_name` STAYS. It is what every existing ad carries, it is what
-- `admin_save_ad` writes, and dropping it would break the ads editor for the
-- sake of tidiness. The new column is the authority when it is set; the label
-- is the fallback.
--
-- ON DELETE SET NULL, not CASCADE: deleting an advertiser record must never
-- delete the ads people have already watched and been paid for.

alter table public.ads
  add column if not exists advertiser_id uuid references public.advertisers (id) on delete set null;

create index if not exists ads_advertiser_idx on public.ads (advertiser_id);

comment on column public.ads.advertiser_id is
  'The advertiser this ad belongs to. Null falls back to the advertiser_name label, which every ad predating migration 055 carries.';

-- Backfill, deliberately narrow.
--
-- Only labels that appear on an ad which is NOT archived. Archived-only
-- labels are this build's own debris — "SidePerks QA", a "SidePerk"/"SidePerks"
-- typo pair — and importing them would seed a money screen with junk on its
-- first render. Their ads keep the text label and lose nothing.
--
-- Everything lands as `pending`, because that is the truth: not one of these
-- advertisers has a recorded payment, so none of them is a paying contract
-- yet. The operator can delete any they do not want; none has payments, so
-- all of them delete cleanly.
insert into public.advertisers (name, status, started_at, notes)
select
  trim(a.advertiser_name),
  'pending',
  min(a.created_at),
  'Created automatically from the advertiser label on existing ads (migration 055).'
from public.ads a
where a.advertiser_name is not null
  and length(trim(a.advertiser_name)) between 2 and 120
  and a.status <> 'archived'
group by trim(a.advertiser_name)
on conflict do nothing;

update public.ads a
   set advertiser_id = adv.id
  from public.advertisers adv
 where a.advertiser_id is null
   and a.advertiser_name is not null
   and lower(trim(a.advertiser_name)) = lower(trim(adv.name));


-- ---------------------------------------------------------------------------
-- 5. RLS
-- ---------------------------------------------------------------------------
--
-- Advertiser contracts and receipts are operator books. No user has any
-- business reading them, so there is exactly one policy on each table and it
-- is `is_admin()`. The admin functions below run as SECURITY DEFINER through
-- the service client anyway; these policies are what make a direct PostgREST
-- read from a signed-in browser return nothing.

alter table public.advertisers          enable row level security;
alter table public.advertiser_payments  enable row level security;

drop policy if exists "Admins read advertisers" on public.advertisers;
create policy "Admins read advertisers" on public.advertisers
  for select to authenticated using (public.is_admin());

drop policy if exists "Admins read advertiser payments" on public.advertiser_payments;
create policy "Admins read advertiser payments" on public.advertiser_payments
  for select to authenticated using (public.is_admin());

-- No insert/update/delete policy for anybody. Writes go through the functions
-- below, which verify the acting admin and record who acted.
revoke all on public.advertisers         from anon, authenticated;
revoke all on public.advertiser_payments from anon, authenticated;
grant select on public.advertisers        to authenticated;
grant select on public.advertiser_payments to authenticated;


-- ---------------------------------------------------------------------------
-- 6. admin_list_advertisers
-- ---------------------------------------------------------------------------
--
-- WHY paid AND delivered TRAVEL TOGETHER
-- The screen exists to answer one question that costs money to get wrong:
-- which contract is nearly spent. That needs both halves — what they paid,
-- and what has been served against it — and neither is stored. Paid is the
-- sum of their receipts; delivered is the value of the points actually
-- credited for their ads, taken from the LEDGER rather than from
-- `completions_count × points_reward`, because the reward is tier-adjusted at
-- credit time and the ledger is the only record of what was really paid out.
--
-- Each ledger row carries the rate that applied when it was written
-- (`points_per_currency_unit`), so historic entries keep their own valuation
-- even if the rate is ever changed. That is the same reason the column exists
-- on the ledger at all.

drop function if exists public.admin_list_advertisers();

create function public.admin_list_advertisers()
returns table (
  id           uuid,
  name         text,
  contact      text,
  status       text,
  paid_ghs     numeric,
  spent_ghs    numeric,
  ads_live     int,
  ads_total    int,
  payments     int,
  last_paid_at timestamptz,
  started_at   timestamptz,
  ends_at      timestamptz,
  notes        text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  -- Same guard as every other admin_list_*: an admin's own browser token
  -- answers to is_admin(); a null caller is the service client.
  if (select auth.uid()) is not null and not public.is_admin() then
    raise exception 'Not an administrator' using errcode = 'insufficient_privilege';
  end if;

  return query
  select
    adv.id,
    adv.name,
    adv.contact,
    adv.status::text,

    coalesce((select sum(p.amount_minor)::numeric / 100
                from public.advertiser_payments p
               where p.advertiser_id = adv.id), 0),

    coalesce((select sum(l.amount::numeric / l.points_per_currency_unit)
                from public.points_ledger l
                join public.ads a on a.id::text = l.reference_id
               where l.reference_type = 'ad'
                 and l.amount > 0
                 and a.advertiser_id = adv.id), 0),

    (select count(*)::int from public.ads a
      where a.advertiser_id = adv.id and a.status = 'active'),
    (select count(*)::int from public.ads a where a.advertiser_id = adv.id),

    (select count(*)::int from public.advertiser_payments p where p.advertiser_id = adv.id),
    (select max(p.received_at) from public.advertiser_payments p where p.advertiser_id = adv.id),

    adv.started_at,
    adv.ends_at,
    adv.notes
  from public.advertisers adv
  order by
    -- Anything needing attention first: a contract agreed but unpaid, then
    -- the live ones, then the finished. Newest within each.
    case adv.status when 'pending' then 0 when 'active' then 1 else 2 end,
    adv.started_at desc;
end;
$$;

comment on function public.admin_list_advertisers() is
  'Advertiser contracts with what they paid and what has been delivered against it. Delivered comes from the ledger, not from completion counts, because the reward is tier-adjusted at credit time.';

revoke execute on function public.admin_list_advertisers() from public, anon;
grant execute on function public.admin_list_advertisers() to authenticated, service_role;


-- ---------------------------------------------------------------------------
-- 7. admin_save_advertiser
-- ---------------------------------------------------------------------------
--
-- Insert when the payload has no id, update when it has one — the same shape
-- as `admin_save_ad`, so the editor round-trips without a translation layer.

create or replace function public.admin_save_advertiser(p_admin_id uuid, p_advertiser jsonb)
returns public.advertisers
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id   uuid := nullif(p_advertiser ->> 'id', '')::uuid;
  v_name text := trim(coalesce(p_advertiser ->> 'name', ''));
  v_out  public.advertisers;
begin
  perform public.assert_admin(p_admin_id);

  if length(v_name) < 2 then
    raise exception 'An advertiser needs a name' using errcode = 'check_violation';
  end if;

  -- Checked here as well as by the unique index, because the index raises
  -- 23505 with a constraint name and this raises a sentence.
  if exists (
    select 1 from public.advertisers a
     where lower(trim(a.name)) = lower(v_name)
       and (v_id is null or a.id <> v_id)
  ) then
    raise exception 'There is already an advertiser called %', v_name
      using errcode = 'check_violation';
  end if;

  if v_id is null then
    insert into public.advertisers (name, contact, status, started_at, ends_at, notes, created_by)
    values (
      v_name,
      nullif(trim(coalesce(p_advertiser ->> 'contact', '')), ''),
      coalesce(nullif(p_advertiser ->> 'status', ''), 'pending')::public.advertiser_status,
      coalesce((p_advertiser ->> 'startedAt')::timestamptz, now()),
      (p_advertiser ->> 'endsAt')::timestamptz,
      nullif(trim(coalesce(p_advertiser ->> 'notes', '')), ''),
      p_admin_id
    )
    returning * into v_out;
  else
    update public.advertisers
       set name       = v_name,
           contact    = nullif(trim(coalesce(p_advertiser ->> 'contact', '')), ''),
           status     = coalesce(nullif(p_advertiser ->> 'status', ''), status::text)::public.advertiser_status,
           started_at = coalesce((p_advertiser ->> 'startedAt')::timestamptz, started_at),
           ends_at    = (p_advertiser ->> 'endsAt')::timestamptz,
           notes      = nullif(trim(coalesce(p_advertiser ->> 'notes', '')), ''),
           updated_at = now()
     where id = v_id
    returning * into v_out;

    if not found then
      raise exception 'Unknown advertiser' using errcode = 'check_violation';
    end if;
  end if;

  return v_out;
end;
$$;

revoke execute on function public.admin_save_advertiser(uuid, jsonb) from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 8. admin_delete_advertiser
-- ---------------------------------------------------------------------------
--
-- Same shape as `admin_delete_ad`, and for the same reason: delete while the
-- record is still empty, otherwise END it. A contract with money against it
-- is a receipt, and receipts do not get deleted because somebody tidied a
-- list — the Finance statement is built from them and would silently change.
--
-- Returns which of the two happened, so the UI can say so rather than guess.

create or replace function public.admin_delete_advertiser(p_admin_id uuid, p_advertiser_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare v_payments int;
begin
  perform public.assert_admin(p_admin_id);

  select count(*) into v_payments
    from public.advertiser_payments p where p.advertiser_id = p_advertiser_id;

  if v_payments > 0 then
    update public.advertisers
       set status = 'ended', ends_at = coalesce(ends_at, now()), updated_at = now()
     where id = p_advertiser_id;

    if not found then
      raise exception 'Unknown advertiser' using errcode = 'check_violation';
    end if;
    return 'ended';
  end if;

  delete from public.advertisers where id = p_advertiser_id;
  if not found then
    raise exception 'Unknown advertiser' using errcode = 'check_violation';
  end if;
  return 'deleted';
end;
$$;

revoke execute on function public.admin_delete_advertiser(uuid, uuid) from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 9. Payments in and out of the record
-- ---------------------------------------------------------------------------
--
-- Recording money is the one write on this screen that changes a figure the
-- operator makes decisions on, so it is also the one that must be reversible:
-- a mis-keyed amount that cannot be removed would sit in the deposits total
-- and the monthly statement for ever. Hence a delete, and hence it is a
-- delete rather than a negative row — see the amount constraint above.

create or replace function public.admin_record_advertiser_payment(
  p_admin_id      uuid,
  p_advertiser_id uuid,
  p_amount_minor  bigint,
  p_received_at   timestamptz default now(),
  p_method        text default null,
  p_reference     text default null,
  p_note          text default null
)
returns public.advertiser_payments
language plpgsql
security definer
set search_path = ''
as $$
declare v_out public.advertiser_payments;
begin
  perform public.assert_admin(p_admin_id);

  if p_amount_minor is null or p_amount_minor <= 0 then
    raise exception 'A payment needs an amount' using errcode = 'check_violation';
  end if;

  if not exists (select 1 from public.advertisers a where a.id = p_advertiser_id) then
    raise exception 'Unknown advertiser' using errcode = 'check_violation';
  end if;

  -- A payment dated in the future is a keying slip, and it would land in a
  -- month the statement has not reached yet.
  if p_received_at > now() + interval '1 day' then
    raise exception 'That payment date is in the future' using errcode = 'check_violation';
  end if;

  insert into public.advertiser_payments
    (advertiser_id, amount_minor, received_at, method, reference, note, recorded_by)
  values
    (p_advertiser_id, p_amount_minor, coalesce(p_received_at, now()),
     nullif(trim(coalesce(p_method, '')), ''),
     nullif(trim(coalesce(p_reference, '')), ''),
     nullif(trim(coalesce(p_note, '')), ''),
     p_admin_id)
  returning * into v_out;

  -- Money arriving is what turns an agreed contract into a live one. Doing it
  -- here means the operator cannot end up with a paid advertiser still
  -- sitting in the "unpaid" bucket because they forgot a dropdown.
  update public.advertisers
     set status = 'active', updated_at = now()
   where id = p_advertiser_id and status = 'pending';

  return v_out;
end;
$$;

revoke execute on function public.admin_record_advertiser_payment(uuid, uuid, bigint, timestamptz, text, text, text)
  from public, anon, authenticated;


create or replace function public.admin_delete_advertiser_payment(p_admin_id uuid, p_payment_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.assert_admin(p_admin_id);

  delete from public.advertiser_payments where id = p_payment_id;
  if not found then
    raise exception 'Unknown payment' using errcode = 'check_violation';
  end if;
end;
$$;

revoke execute on function public.admin_delete_advertiser_payment(uuid, uuid) from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 10. One advertiser's receipts, for the review panel
-- ---------------------------------------------------------------------------

drop function if exists public.admin_list_advertiser_payments(uuid);

create function public.admin_list_advertiser_payments(p_advertiser_id uuid)
returns table (
  id          uuid,
  amount_ghs  numeric,
  received_at timestamptz,
  method      text,
  reference   text,
  note        text,
  recorded_by text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is not null and not public.is_admin() then
    raise exception 'Not an administrator' using errcode = 'insufficient_privilege';
  end if;

  return query
  select p.id,
         p.amount_minor::numeric / 100,
         p.received_at,
         p.method,
         p.reference,
         p.note,
         u.email::text
    from public.advertiser_payments p
    left join auth.users u on u.id = p.recorded_by
   where p.advertiser_id = p_advertiser_id
   order by p.received_at desc;
end;
$$;

revoke execute on function public.admin_list_advertiser_payments(uuid) from public, anon;
grant execute on function public.admin_list_advertiser_payments(uuid) to authenticated, service_role;


-- ---------------------------------------------------------------------------
-- 11. Audit
-- ---------------------------------------------------------------------------
--
-- Both tables move money figures, so both are audited by the same trigger
-- every other consequential table uses. `assert_admin` has set `app.actor_id`
-- by the time these fire (migration 053), so the trail carries a name.

-- The trigger takes the primary-key column name as tg_argv[0] — without it
-- every audit row would record a null entity_id and the trail would say that
-- something changed without saying what.
drop trigger if exists trg_audit_advertisers on public.advertisers;
create trigger trg_audit_advertisers
  after insert or update or delete on public.advertisers
  for each row execute function public.audit_row_change('id');

drop trigger if exists trg_audit_advertiser_payments on public.advertiser_payments;
create trigger trg_audit_advertiser_payments
  after insert or update or delete on public.advertiser_payments
  for each row execute function public.audit_row_change('id');
