-- ============================================================================
-- Migration 124 — Affiliate Ops: the affiliates list, the conversions browser
--                 and the commission queue
--
-- Reads, plus one write: suspending an affiliate. The manual commission
-- adjustment the brief asks for (§7.3) is money-touching and is NOT here — it
-- needs its own G4 plan.
--
-- ---------------------------------------------------------------------------
-- WHAT THE CONVERSIONS BROWSER IS ACTUALLY FOR
--
-- Not browsing. It is for answering "why was I not paid for that sale?", which
-- is the single most common argument an affiliate programme produces, and the
-- one that is impossible to settle after the fact unless the answer was
-- written down at the time.
--
-- Everything needed to reconstruct a decision is already frozen on the
-- conversion row — the click it came from, the SubID, the rates that applied,
-- and what the upline could do AT THAT INSTANT (C22). This just puts it on a
-- screen. A support agent should never have to open SQL to answer it.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. The affiliates list
-- ---------------------------------------------------------------------------
--
-- Deliberately NOT a second copy of the promotion report. That one answers
-- "who is recruiting rather than selling"; this one answers "who is this
-- person and what are they owed". Overlapping columns exist because both
-- screens need them, but the questions are different and so is the sort.

create or replace function public.admin_list_affiliates(p_scope text default 'all')
returns table (
  affiliate_id     uuid,
  user_id          uuid,
  name             text,
  email            text,
  affiliate_code   text,
  status           text,
  depth_now        int,
  tier             text,
  activated_at     timestamptz,
  promotion_ends   timestamptz,
  upline_name      text,
  recruits         int,
  clicks           int,
  conversions      int,
  gross_minor      bigint,
  reversed_minor   bigint,
  paid_out_minor   bigint,
  balance_minor    bigint,
  pending_minor    bigint,
  joined_at        timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select a.id,
         a.user_id,
         coalesce(p.full_name, '')::text,
         u.email::text,
         a.affiliate_code,
         a.status::text,
         public.affiliate_depth_now(a.id),
         /* The tier they actually hold, named. `depth_now` is the number the
            money path uses; this is the word a support agent says out loud. */
         (select tp.level::text
            from public.affiliate_entitlements e
            join public.training_programs tp on tp.id = e.training_program_id
           where e.affiliate_id = a.id and e.status = 'active'
           order by e.commission_depth desc limit 1),
         a.activated_at,
         /* When the right to promote actually runs out — the end of GRACE, not
            of the term, because they can still earn until then (B11e). */
         (select max(e.grace_ends_at) from public.affiliate_entitlements e
           where e.affiliate_id = a.id and e.status = 'active'),
         (select coalesce(pp.full_name, '')::text
            from public.affiliate_accounts up
            join public.profiles pp on pp.id = up.user_id
           where up.id = a.parent_affiliate_id),
         (select count(*)::int from public.affiliate_accounts d
           where d.parent_affiliate_id = a.id),
         (select count(*)::int from public.affiliate_clicks c where c.affiliate_id = a.id),
         (select count(*)::int from public.conversions cv
           where cv.affiliate_id = a.id and cv.status = 'attributed'),
         coalesce((select sum(l.amount_minor) from public.commission_ledger l
                    where l.affiliate_id = a.id and l.entry_type = 'credit'), 0)::bigint,
         coalesce((select sum(l.amount_minor) from public.commission_ledger l
                    where l.affiliate_id = a.id and l.entry_type = 'reversal'), 0)::bigint,
         coalesce((select sum(-l.amount_minor) from public.commission_ledger l
                    where l.affiliate_id = a.id and l.entry_type = 'payout'
                      and l.status = 'paid'), 0)::bigint,
         public.affiliate_balance_minor(a.id),
         public.affiliate_pending_minor(a.id),
         a.created_at
    from public.affiliate_accounts a
    join public.profiles p on p.id = a.user_id
    join auth.users u on u.id = a.user_id
   where case p_scope
           when 'active'    then a.status = 'active'
           when 'pending'   then a.status = 'pending'
           when 'suspended' then a.status = 'suspended'
           /* Lapsed is not a status — it is a date that has passed, which is
              why `affiliate_depth_now` computes it live. Asked as a question
              rather than stored, so it can never be stale. */
           when 'lapsed'    then public.affiliate_depth_now(a.id) = 0 and a.status = 'active'
           when 'owed'      then public.affiliate_balance_minor(a.id) > 0
           else true
         end
   order by a.created_at desc;
$$;


-- ---------------------------------------------------------------------------
-- 2. The conversions browser
-- ---------------------------------------------------------------------------

create or replace function public.admin_list_conversions(
  p_from timestamptz default now() - interval '30 days',
  p_to   timestamptz default now(),
  p_affiliate_id uuid default null
)
returns table (
  conversion_id     uuid,
  order_id          uuid,
  attributed_at     timestamptz,
  product_title     text,
  product_purpose   text,
  order_kind        text,
  buyer_name        text,
  base_minor        bigint,
  affiliate_code    text,
  affiliate_name    text,
  l1_rate           numeric,
  l1_minor          bigint,
  l2_affiliate_name text,
  l2_rate           numeric,
  l2_minor          bigint,
  l2_depth_at_conversion int,
  subid             text,
  attributed_by     text,
  clicked_at        timestamptz,
  status            text
)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, c.order_id, c.attributed_at,
         p.title, p.purpose::text, o.kind::text,
         coalesce(buyer.full_name, '')::text,
         c.base_minor,
         a.affiliate_code,
         coalesce(seller.full_name, '')::text,
         c.l1_rate,
         coalesce((select l.amount_minor from public.commission_ledger l
                    where l.conversion_id = c.id and l.level = 1 and l.entry_type = 'credit'), 0)::bigint,
         coalesce(upline.full_name, '')::text,
         c.l2_rate,
         coalesce((select l.amount_minor from public.commission_ledger l
                    where l.conversion_id = c.id and l.level = 2 and l.entry_type = 'credit'), 0)::bigint,
         c.l2_depth_at_conversion,
         c.subid,
         /* WHY this affiliate got it. The answer to the argument, in one
            column: a tracked click, or the upline rule that governs an
            upgrade (B8), which has no click at all. */
         case
           when c.click_id is not null then 'click'
           when o.kind = 'training_upgrade' then 'upline (upgrade)'
           else 'unknown'
         end,
         (select cl.created_at from public.affiliate_clicks cl where cl.id = c.click_id),
         c.status::text
    from public.conversions c
    join public.orders o   on o.id = c.order_id
    join public.products p on p.id = o.product_id
    join public.profiles buyer on buyer.id = o.user_id
    join public.affiliate_accounts a on a.id = c.affiliate_id
    join public.profiles seller on seller.id = a.user_id
    left join public.affiliate_accounts up on up.id = c.l2_affiliate_id
    left join public.profiles upline on upline.id = up.user_id
   where c.attributed_at >= p_from
     and c.attributed_at <  p_to
     and (p_affiliate_id is null
          or c.affiliate_id = p_affiliate_id
          or c.l2_affiliate_id = p_affiliate_id)
   order by c.attributed_at desc;
$$;


-- ---------------------------------------------------------------------------
-- 3. The commission queue
-- ---------------------------------------------------------------------------
--
-- Every entry, filterable by state. Reversals and payouts are included rather
-- than hidden: a queue that only shows credits is a queue that cannot explain
-- why somebody's balance went down.

create or replace function public.admin_list_commissions(
  p_status text default null,
  p_affiliate_id uuid default null,
  p_from timestamptz default now() - interval '90 days'
)
returns table (
  ledger_id      uuid,
  created_at     timestamptz,
  affiliate_id   uuid,
  affiliate_code text,
  affiliate_name text,
  level          int,
  entry_type     text,
  amount_minor   bigint,
  status         text,
  clears_at      timestamptz,
  product_title  text,
  order_id       uuid,
  reason         text
)
language sql
stable
security definer
set search_path = ''
as $$
  select l.id, l.created_at, l.affiliate_id, a.affiliate_code,
         coalesce(p.full_name, '')::text,
         l.level, l.entry_type::text, l.amount_minor, l.status::text, l.clears_at,
         prod.title, c.order_id, l.reason
    from public.commission_ledger l
    join public.affiliate_accounts a on a.id = l.affiliate_id
    join public.profiles p on p.id = a.user_id
    left join public.conversions c on c.id = l.conversion_id
    left join public.orders o on o.id = c.order_id
    left join public.products prod on prod.id = o.product_id
   where l.created_at >= p_from
     and (p_status is null or l.status::text = p_status)
     and (p_affiliate_id is null or l.affiliate_id = p_affiliate_id)
   order by l.created_at desc;
$$;


/* The numbers above the queue. One row, so the screen does not run five
   queries to draw a header. */
create or replace function public.admin_commission_totals(
  p_from timestamptz default now() - interval '30 days',
  p_to   timestamptz default now()
)
returns table (
  pending_minor  bigint,
  cleared_minor  bigint,
  reversed_minor bigint,
  paid_minor     bigint,
  owed_minor     bigint,
  affiliates_owed int
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    coalesce(sum(l.amount_minor) filter (where l.status = 'pending' and l.entry_type = 'credit'), 0)::bigint,
    coalesce(sum(l.amount_minor) filter (where l.status = 'cleared' and l.entry_type = 'credit'), 0)::bigint,
    coalesce(sum(-l.amount_minor) filter (where l.entry_type = 'reversal'), 0)::bigint,
    coalesce(sum(-l.amount_minor) filter (where l.entry_type = 'payout' and l.status = 'paid'), 0)::bigint,
    /* What is actually owed RIGHT NOW, across everybody. Not a sum of the
       columns above — a negative balance from a post-payout reversal (C21)
       must not be netted off against somebody else's credit, or the figure
       understates what is owed to the people who are owed. */
    coalesce((select sum(b) from (
       select public.affiliate_balance_minor(a.id) as b from public.affiliate_accounts a
     ) t where b > 0), 0)::bigint,
    (select count(*)::int from public.affiliate_accounts a
      where public.affiliate_balance_minor(a.id) > 0)
  from public.commission_ledger l
 where l.created_at >= p_from and l.created_at < p_to;
$$;


-- ---------------------------------------------------------------------------
-- 4. Suspending an affiliate
-- ---------------------------------------------------------------------------
--
-- The action the promotion report exists to enable (G44): the Owner wanted to
-- see who is "more focus on referrals than promoting sales of products" and be
-- able to act.
--
-- ⚠️ SUSPENSION STOPS EARNING IMMEDIATELY, because `affiliate_depth_now`
-- requires an ACTIVE account — so a suspended affiliate attributes no new
-- commission and pays no override. It does NOT touch money already earned:
-- clawing back past commission is a separate, deliberate act with its own
-- reason, not a side effect of a status change.
--
-- A reason is required, and the whole thing is audit-logged. A suspension
-- somebody cannot explain later is one that gets quietly reversed.

create or replace function public.admin_set_affiliate_status(
  p_admin_id uuid,
  p_affiliate_id uuid,
  p_status public.affiliate_status,
  p_reason text default null
)
returns public.affiliate_accounts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old   public.affiliate_accounts;
  v_out   public.affiliate_accounts;
  v_email text;
begin
  perform public.assert_admin(p_admin_id);

  if p_status = 'suspended' and (p_reason is null or length(btrim(p_reason)) = 0) then
    raise exception 'A suspension needs a reason' using errcode = 'check_violation';
  end if;

  select * into v_old from public.affiliate_accounts where id = p_affiliate_id;
  if not found then
    raise exception 'Unknown affiliate' using errcode = 'check_violation';
  end if;

  /* Reinstating somebody who never activated returns them to `pending`, not
     to `active` — they still have to finish the training. Sending them
     straight to active would hand out the right to earn that the threshold
     exists to gate. */
  update public.affiliate_accounts
     set status = case
                    when p_status = 'active' and v_old.activated_at is null then 'pending'
                    else p_status
                  end,
         updated_at = now()
   where id = p_affiliate_id
  returning * into v_out;

  select u.email::text into v_email from auth.users u where u.id = p_admin_id;
  insert into public.admin_audit_log
    (actor_id, actor_email, action, entity_type, entity_id, old_values, new_values)
  values (
    p_admin_id, v_email, 'update', 'affiliate_accounts', p_affiliate_id,
    jsonb_build_object('status', v_old.status),
    jsonb_build_object('status', v_out.status, 'reason', p_reason)
  );

  return v_out;
end;
$$;


-- ---------------------------------------------------------------------------
-- 5. Grants
-- ---------------------------------------------------------------------------

do $$
declare v_sig text;
begin
  foreach v_sig in array array[
    'public.admin_list_affiliates(text)',
    'public.admin_list_conversions(timestamptz, timestamptz, uuid)',
    'public.admin_list_commissions(text, uuid, timestamptz)',
    'public.admin_commission_totals(timestamptz, timestamptz)',
    'public.admin_set_affiliate_status(uuid, uuid, public.affiliate_status, text)'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated', v_sig);
    execute format('grant execute on function %s to service_role', v_sig);
  end loop;
end $$;
