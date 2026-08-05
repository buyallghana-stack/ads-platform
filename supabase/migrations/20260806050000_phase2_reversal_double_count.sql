-- ============================================================================
-- Migration 116 — a reversal was subtracted TWICE
--
-- Found by the commission tests: an affiliate who earned 6,000, withdrew it,
-- and then had the sale refunded ended on a balance of −12,000 instead of
-- −6,000. The refund took the money back twice.
--
-- ---------------------------------------------------------------------------
-- WHAT WENT WRONG
--
-- `reverse_conversion_commissions` did two things at once, and either alone
-- would have been correct:
--
--   1. inserted a REVERSAL row for −6,000  (proper double entry)
--   2. set the original credit's status to 'reversed'
--
-- But `affiliate_balance_minor` sums rows whose status is cleared, requested
-- or paid. Step 2 pushed the +6,000 credit OUT of that set, so the credit
-- stopped counting AND the −6,000 reversal was applied on top. The money came
-- off twice.
--
-- The mistake is treating the credit's status as a summary of what happened.
-- In a ledger, what happened is the ROWS: the credit stays exactly as it was
-- written and a reversal sits beside it. That is the whole reason the reversal
-- row exists, and the reason the table refuses edits to an amount.
--
-- ---------------------------------------------------------------------------
-- THE FIX
--
-- The credit is left alone. Reversing twice is prevented by checking for an
-- existing reversal row rather than by mutating the credit — which was already
-- guaranteed anyway by the `reversal:<credit_id>` idempotency key, so the
-- status write was buying nothing and costing 6,000.
--
-- `reconcile_commission_ledger` is updated to match: a credit is unreversed
-- when no reversal row references it, not when a status column says so.
-- ============================================================================

create or replace function public.reverse_conversion_commissions(
  p_conversion_id uuid,
  p_reason text
)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entry    public.commission_ledger;
  v_reversed int := 0;
begin
  if p_reason is null or length(btrim(p_reason)) = 0 then
    raise exception 'A reversal needs a reason' using errcode = 'check_violation';
  end if;

  for v_entry in
    select l.* from public.commission_ledger l
     where l.conversion_id = p_conversion_id
       and l.entry_type = 'credit'
       /* Already reversed? Asked of the ROWS, not of a status column. The
          ledger's truth is what is written in it. */
       and not exists (
         select 1 from public.commission_ledger r
          where r.entry_type = 'reversal'
            and r.idempotency_key = 'reversal:' || l.id::text
       )
  loop
    insert into public.commission_ledger
      (affiliate_id, conversion_id, level, entry_type, amount_minor, status,
       reason, idempotency_key)
    values
      (v_entry.affiliate_id, v_entry.conversion_id, v_entry.level, 'reversal',
       -v_entry.amount_minor, 'cleared', p_reason,
       'reversal:' || v_entry.id::text)
    on conflict (idempotency_key) do nothing;

    /* THE CREDIT IS NOT TOUCHED. Marking it 'reversed' removed it from the
       balance sum while the reversal row was also subtracting, and the money
       came off twice. */

    v_reversed := v_reversed + 1;
  end loop;

  update public.conversions set status = 'reversed' where id = p_conversion_id;

  return v_reversed;
end;
$$;

revoke execute on function public.reverse_conversion_commissions(uuid, text) from public, anon, authenticated;
grant execute on function public.reverse_conversion_commissions(uuid, text) to service_role;


create or replace function public.reconcile_commission_ledger()
returns table (
  affiliate_id uuid,
  problem      text,
  detail       jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  -- A credit standing against a conversion that was reversed, with no
  -- reversal row of its own: money still owed for a sale that was undone.
  -- Asked of the rows now, not of a status column.
  select l.affiliate_id,
         'credit stands against a reversed conversion' as problem,
         jsonb_build_object('ledger_id', l.id, 'conversion_id', l.conversion_id,
                            'amount_minor', l.amount_minor) as detail
    from public.commission_ledger l
    join public.conversions c on c.id = l.conversion_id
   where l.entry_type = 'credit'
     and c.status = 'reversed'
     and not exists (
       select 1 from public.commission_ledger r
        where r.entry_type = 'reversal'
          and r.idempotency_key = 'reversal:' || l.id::text
     )

  union all

  select l.affiliate_id,
         'reversal with no credit behind it',
         jsonb_build_object('ledger_id', l.id, 'conversion_id', l.conversion_id)
    from public.commission_ledger l
   where l.entry_type = 'reversal'
     and not exists (
       select 1 from public.commission_ledger c
        where c.conversion_id = l.conversion_id
          and c.level = l.level
          and c.entry_type = 'credit'
     )

  union all

  select l.affiliate_id,
         'credit exceeds the sale it came from',
         jsonb_build_object('ledger_id', l.id, 'amount_minor', l.amount_minor,
                            'base_minor', c.base_minor)
    from public.commission_ledger l
    join public.conversions c on c.id = l.conversion_id
   where l.entry_type = 'credit'
     and l.amount_minor > c.base_minor

  union all

  select c.affiliate_id,
         'both levels together exceed the sale',
         jsonb_build_object('conversion_id', c.id, 'base_minor', c.base_minor,
                            'paid_minor', sum(l.amount_minor))
    from public.conversions c
    join public.commission_ledger l
      on l.conversion_id = c.id and l.entry_type = 'credit'
   group by c.id, c.affiliate_id, c.base_minor
  having sum(l.amount_minor) > c.base_minor

  union all

  /* NEW, because this is the failure that was live for one migration: a
     reversal that took money off twice. If a credit has more than one
     reversal against it, or a reversal that is not the negative of its
     credit, the balance is wrong and nothing else would notice. */
  select l.affiliate_id,
         'more than one reversal against a credit',
         jsonb_build_object('conversion_id', l.conversion_id, 'level', l.level,
                            'reversals', count(*))
    from public.commission_ledger l
   where l.entry_type = 'reversal'
   group by l.affiliate_id, l.conversion_id, l.level
  having count(*) > 1;
$$;

revoke execute on function public.reconcile_commission_ledger() from public, anon, authenticated;
grant execute on function public.reconcile_commission_ledger() to service_role;
