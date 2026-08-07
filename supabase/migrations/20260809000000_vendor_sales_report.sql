-- ---------------------------------------------------------------------------
-- What each vendor's products sold, so the Owner can settle with them offline.
--
-- ⚠️ THIS DELIBERATELY DOES NOT SAY WHAT A VENDOR IS OWED.
--
-- Decision A4: there is no vendor payable ledger — the Owner licenses a product
-- outright and the system never tracks money owed to a vendor. A3: reporting is
-- a CSV the admin exports and sends by hand. Nothing in this schema knows any
-- vendor's licence terms, so a column called "owed" could only be an invented
-- number on a money screen. What this returns is what their products SOLD; what
-- gets paid is the agreement, and that lives outside the software.
--
-- ── ONE ROW'S ARITHMETIC IS ABOUT ONE SET OF ORDERS ──
--
-- The window is on `confirmed_at`: a sale belongs to the period the money came
-- in. A refund is then deducted from THAT period even if it happened later,
-- because the alternative — windowing refunds by `refunded_at` — produces a row
-- whose own numbers do not reconcile, where the refund deducted has no matching
-- sale above it. A settlement report that cannot be checked by eye is worse than
-- none.
--
--     gross − refunded − commission = net
--
-- ── COMMISSION IS NET OF REVERSALS ──
--
-- Reaching it: commission_ledger → conversions → orders → products.vendor_id.
-- Credits and reversals are summed together rather than subtracted in the UI, so
-- a clawed-back sale costs the same in the report as it did in reality.
-- ---------------------------------------------------------------------------

create or replace function public.admin_vendor_sales_report(
  p_from timestamptz default now() - interval '30 days',
  p_to   timestamptz default now()
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with sold as (
    select
      o.id            as order_id,
      p.id            as product_id,
      p.title         as product_title,
      p.vendor_id,
      o.amount_minor,
      o.list_price_minor,
      o.refunded_at
    from public.orders o
    join public.products p on p.id = o.product_id
    where p.vendor_id is not null
      /* `confirmed` and `refunded` both mean the money arrived. A refunded
         order still belongs in the period it sold in — it is deducted below,
         not hidden, or the report would quietly overstate nothing and
         understate everything. */
      and o.status in ('confirmed', 'refunded')
      and o.confirmed_at >= p_from
      and o.confirmed_at <  p_to
  ),
  commission as (
    select
      s.order_id,
      coalesce(sum(cl.amount_minor), 0)::bigint as commission_minor
    from sold s
    join public.conversions c on c.order_id = s.order_id
    join public.commission_ledger cl on cl.conversion_id = c.id
    /* Credits are positive and reversals negative, so one sum is the net cost
       of that sale in commission. Payout rows are excluded — they are the
       affiliate being paid, not this sale costing more. */
    where cl.entry_type in ('credit', 'reversal')
    group by s.order_id
  ),
  per_order as (
    select
      s.*,
      coalesce(cm.commission_minor, 0)::bigint as commission_minor
    from sold s
    left join commission cm on cm.order_id = s.order_id
  ),
  per_vendor as (
    select
      v.id                                                        as vendor_id,
      v.name,
      v.status::text                                              as status,
      count(distinct po.product_id)::int                          as products,
      count(*) filter (where po.refunded_at is null)::int          as units,
      coalesce(sum(po.amount_minor) filter (where po.refunded_at is null), 0)::bigint      as gross_minor,
      coalesce(sum(po.list_price_minor) filter (where po.refunded_at is null), 0)::bigint  as list_minor,
      count(*) filter (where po.refunded_at is not null)::int      as refunded_units,
      coalesce(sum(po.amount_minor) filter (where po.refunded_at is not null), 0)::bigint  as refunded_minor,
      coalesce(sum(po.commission_minor), 0)::bigint                as commission_minor
    from per_order po
    join public.vendors v on v.id = po.vendor_id
    group by v.id, v.name, v.status
  ),
  per_product as (
    select
      po.vendor_id,
      po.product_id,
      po.product_title,
      count(*) filter (where po.refunded_at is null)::int          as units,
      coalesce(sum(po.amount_minor) filter (where po.refunded_at is null), 0)::bigint      as gross_minor,
      coalesce(sum(po.list_price_minor) filter (where po.refunded_at is null), 0)::bigint  as list_minor,
      count(*) filter (where po.refunded_at is not null)::int      as refunded_units,
      coalesce(sum(po.amount_minor) filter (where po.refunded_at is not null), 0)::bigint  as refunded_minor,
      coalesce(sum(po.commission_minor), 0)::bigint                as commission_minor
    from per_order po
    group by po.vendor_id, po.product_id, po.product_title
  )
  select jsonb_build_object(
    'from', p_from,
    'to',   p_to,
    'vendors', coalesce((
      select jsonb_agg(jsonb_build_object(
               'vendor_id',       pv.vendor_id,
               'name',            pv.name,
               'status',          pv.status,
               'products',        pv.products,
               'units',           pv.units,
               'gross_minor',     pv.gross_minor,
               'list_minor',      pv.list_minor,
               'refunded_units',  pv.refunded_units,
               'refunded_minor',  pv.refunded_minor,
               'commission_minor',pv.commission_minor,
               'net_minor',       pv.gross_minor - pv.refunded_minor - pv.commission_minor
             ) order by pv.gross_minor desc, pv.name)
        from per_vendor pv
    ), '[]'::jsonb),
    'products', coalesce((
      select jsonb_agg(jsonb_build_object(
               'vendor_id',       pp.vendor_id,
               'product_id',      pp.product_id,
               'title',           pp.product_title,
               'units',           pp.units,
               'gross_minor',     pp.gross_minor,
               'list_minor',      pp.list_minor,
               'refunded_units',  pp.refunded_units,
               'refunded_minor',  pp.refunded_minor,
               'commission_minor',pp.commission_minor,
               'net_minor',       pp.gross_minor - pp.refunded_minor - pp.commission_minor
             ) order by pp.gross_minor desc, pp.product_title)
        from per_product pp
    ), '[]'::jsonb)
  );
$$;

comment on function public.admin_vendor_sales_report(timestamptz, timestamptz) is
  'What each vendor''s products sold in a period, for offline settlement (A3). Never states what a vendor is owed — A4 says the system does not track that, and no licence terms exist in this schema.';

/* ⚠️ `create function` re-grants EXECUTE to PUBLIC. This answers with every
   vendor''s revenue; it is server-only, like the rest of the Phase 2 admin
   reads. */
revoke execute on function public.admin_vendor_sales_report(timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function public.admin_vendor_sales_report(timestamptz, timestamptz)
  to service_role;
