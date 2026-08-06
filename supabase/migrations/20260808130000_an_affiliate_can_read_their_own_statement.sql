-- ============================================================================
-- Migration 152 — an affiliate can read their own statement
--
-- The commission ledger has an admin read (`admin_list_commissions`) and no
-- affiliate one. So the person the money belongs to could see a balance and
-- could not see a single line of what made it up.
--
-- That is not acceptable for real money. The whole argument for an append-only
-- ledger is that history can be shown and not rewritten; a ledger nobody can
-- read is just a balance with extra steps, and the first time somebody
-- disputes a figure the only answer available is "trust us".
--
-- ---------------------------------------------------------------------------
-- WHAT AN ENTRY HAS TO CARRY TO BE READABLE
--
-- An amount and a date are not a statement line. Each row here also carries:
--
--   entry_type   credit / reversal / payout / adjustment — four different
--                events that a signed number alone cannot distinguish. A
--                reversal and a payout are both money leaving, and confusing
--                them is the difference between "I was paid" and "a sale was
--                cancelled".
--   level        1 or 2. On a two-level account, "why is this smaller" is
--                answered entirely by which level it was.
--   status       pending / cleared / requested / paid / reversed
--   clears_at    when a pending entry becomes withdrawable. Without it the
--                answer to "when can I have this" is nowhere on the screen.
--   product      what was sold. The single most useful field for recognising
--                an entry, and the one an amount cannot substitute for.
--
-- ---------------------------------------------------------------------------
-- PAYOUT REQUESTS COME BACK TOO, AND SEPARATELY
--
-- A requested payout is not a ledger entry until it is paid — the ledger row
-- is written at payment. So a request that is sitting in the queue would be
-- invisible in a ledger-only statement, and the affiliate would see their
-- balance drop with nothing to explain it. They are returned as their own
-- list, with the FEE and the NET, because what lands in somebody's wallet is
-- the net and that is the figure they will check against.
--
-- ---------------------------------------------------------------------------
-- NOT AN RLS POLICY ON commission_ledger
--
-- Tempting, and wrong. `commission_ledger` is written by SECURITY DEFINER
-- functions and read by admin screens; adding a user-facing SELECT policy
-- widens the table's exposure permanently to save one function. This is the
-- Phase 2 convention (migration 127) and it stays: server-only RPC, takes a
-- user id, so a super admin's read-only look renders the viewed account.
-- ============================================================================

create or replace function public.affiliate_statement(
  p_user_id uuid,
  p_limit   int default 100
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
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
                   'id',           cl.id,
                   'entry_type',   cl.entry_type::text,
                   'amount_minor', cl.amount_minor,
                   'level',        cl.level,
                   'status',       cl.status::text,
                   'clears_at',    cl.clears_at,
                   'reason',       cl.reason,
                   'created_at',   cl.created_at,
                   'product_title', pr.title,
                   'product_slug',  pr.slug
                 ) as x
            from public.commission_ledger cl
            left join public.conversions cv on cv.id = cl.conversion_id
            left join public.orders o       on o.id  = cv.order_id
            left join public.products pr    on pr.id = o.product_id
           where cl.affiliate_id = v_aff
           order by cl.created_at desc
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
               'failure_reason', cp.failure_reason
             ) order by cp.created_at desc)
        from public.commission_payouts cp
       where cp.affiliate_id = v_aff
    ), '[]'::jsonb)
  );
end;
$function$;

comment on function public.affiliate_statement(uuid, int) is
  'The affiliate''s own commission history. Payout REQUESTS are returned separately from ledger entries because a request is not a ledger row until it is paid — without them the balance drops with nothing on screen to explain it.';

/* ⚠️ `create function` re-grants EXECUTE to PUBLIC. Phase 2 is server-only. */
revoke execute on function public.affiliate_statement(uuid, int) from public, anon, authenticated;
grant  execute on function public.affiliate_statement(uuid, int) to service_role;
