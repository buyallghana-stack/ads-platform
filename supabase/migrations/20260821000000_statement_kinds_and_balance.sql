-- ---------------------------------------------------------------------------
-- The commission statement gets what the points statement already has:
-- a KIND per row, and a running balance.
--
-- Operator, 2026-08-08: the affiliate statement should resemble the ads one in
-- logic and display. The ads side groups by day, rolls up runs of the same
-- kind, filters by kind and carries a running balance. None of that is
-- possible from `entry_type` alone — four values, of which one (`adjustment`)
-- currently means a game win, a task reward, a gift code and a hand
-- correction, all at once.
--
-- ── THE KIND IS A GENERATED COLUMN, NOT A CASE IN A QUERY ──
--
-- Derived once, stored, and computed by the database for every row that will
-- ever be written. A `case` inside the statement RPC would be a second
-- definition living far away from the writes, and it would go stale the first
-- time somebody adds a new kind of adjustment.
--
-- ⚠️ IT KEYS OFF `idempotency_key`, NOT `reason`. Both encode where an entry
-- came from, but `reason` is prose shown to the affiliate ("Game prize: GHS 5")
-- and prose gets rewritten; the idempotency key is machine-generated, unique,
-- and already load-bearing, so it is the stabler of the two. The real fix is a
-- kind written explicitly at each call site, and this is the version of that
-- which cannot drift out of step with rows already in the table.
-- ---------------------------------------------------------------------------

alter table public.commission_ledger
  add column if not exists kind text
  generated always as (
    case
      when entry_type = 'payout'   then 'payout'
      when entry_type = 'reversal' then 'reversal'
      /* A credit is always a sale. Level two means the sale was made by
         somebody this affiliate recruited, which is the one distinction the
         affiliate most wants the statement to draw. */
      when entry_type = 'credit' and level = 2 then 'referral'
      when entry_type = 'credit'   then 'sale'
      when idempotency_key like 'affiliate-task-%'  then 'task'
      when idempotency_key like 'affiliate-game-%'  then 'game'
      when idempotency_key like 'commission-gift-%' then 'gift'
      else 'adjustment'
    end
  ) stored;

create index if not exists commission_ledger_kind_idx
  on public.commission_ledger (affiliate_id, kind, created_at desc);

-- ---------------------------------------------------------------------------
-- The statement carries the kind and the balance after each entry.
--
-- ⚠️ THE RUNNING BALANCE IS COMPUTED OVER THE WHOLE LEDGER AND *THEN* LIMITED.
-- Windowing after the limit would restart the sum at whatever the hundredth
-- newest row happened to be, so every balance on the page would be wrong by a
-- constant — the most convincing kind of wrong, because the arithmetic between
-- consecutive rows still checks out.
--
-- Only entries that count toward the balance move it: `cleared`, `requested`
-- and `paid`, exactly as `affiliate_balance_minor` defines it. A pending
-- credit is shown but does not move the running total, which is what makes the
-- last row equal the balance on the dashboard.
-- ---------------------------------------------------------------------------

create or replace function public.affiliate_statement(p_user_id uuid, p_limit integer default 100)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_aff   uuid;
  v_limit int := least(greatest(coalesce(p_limit, 100), 1), 500);
begin
  select id into v_aff from public.affiliate_accounts where user_id = p_user_id;

  /* Not an affiliate: a well-formed empty statement, not an error. */
  if v_aff is null then
    return jsonb_build_object('entries', '[]'::jsonb, 'payouts', '[]'::jsonb);
  end if;

  return jsonb_build_object(
    'entries', coalesce((
      select jsonb_agg(x order by x->>'created_at' desc)
        from (
          select jsonb_build_object(
                   'id',            r.id,
                   'entry_type',    r.entry_type,
                   'kind',          r.kind,
                   'amount_minor',  r.amount_minor,
                   'level',         r.level,
                   'status',        r.status,
                   'clears_at',     r.clears_at,
                   'reason',        r.reason,
                   'created_at',    r.created_at,
                   'balance_after', r.balance_after,
                   'product_title', r.product_title,
                   'product_slug',  r.product_slug
                 ) as x
            from (
              select cl.id,
                     cl.entry_type::text as entry_type,
                     cl.kind,
                     cl.amount_minor,
                     cl.level,
                     cl.status::text as status,
                     cl.clears_at,
                     cl.reason,
                     cl.created_at,
                     sum(
                       case when cl.status in ('cleared', 'requested', 'paid')
                            then cl.amount_minor else 0 end
                     ) over (
                       order by cl.created_at, cl.id
                       rows between unbounded preceding and current row
                     ) as balance_after,
                     pr.title as product_title,
                     pr.slug  as product_slug
                from public.commission_ledger cl
                left join public.conversions cv on cv.id = cl.conversion_id
                left join public.orders o       on o.id  = cv.order_id
                left join public.products pr    on pr.id = o.product_id
               where cl.affiliate_id = v_aff
            ) r
           order by r.created_at desc
           limit v_limit
        ) s
    ), '[]'::jsonb),

    'payouts', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id',           cp.id,
               'amount_minor', cp.amount_minor,
               'fee_minor',    cp.fee_minor,
               'net_minor',    cp.net_minor,
               'fee_percent',  cp.fee_percent,
               'method',       cp.method::text,
               'status',       cp.status::text,
               'created_at',   cp.created_at,
               'paid_at',      cp.paid_at,
               'coin_code',    cp.snapshot_coin_code,
               'coin_amount',  cp.coin_amount
             ) order by cp.created_at desc)
        from public.commission_payouts cp
       where cp.user_id = p_user_id
    ), '[]'::jsonb)
  );
end;
$$;

revoke execute on function public.affiliate_statement(uuid, integer) from public, anon, authenticated;
grant execute on function public.affiliate_statement(uuid, integer) to service_role;
