-- ============================================================================
-- Migration 113 — two gaps in step 5, both found by the attribution tests
--
-- ---------------------------------------------------------------------------
-- 1. A CLICK IS A WALL-CLOCK EVENT, AND `now()` IS NOT A WALL CLOCK
--
-- `affiliate_clicks.created_at` defaulted to `now()`, which in Postgres is the
-- TRANSACTION start time — identical for every row written inside the same
-- transaction. Attribution is "last click wins" (C18), so a tie makes the
-- winner arbitrary: `order by created_at desc limit 1` returns whichever row
-- the planner reaches first.
--
-- In production two clicks are two HTTP requests and two transactions, so they
-- differ — which is exactly why this would never have surfaced in the product
-- and would instead have shown up as an affiliate insisting the wrong person
-- was paid. `clock_timestamp()` reads the actual clock at insert, so the order
-- of clicks is the order they happened, and the ordering is tie-broken by id
-- so it is at least deterministic if two ever land in the same microsecond.
--
-- ---------------------------------------------------------------------------
-- 2. A LINK TO A PRODUCT THAT PAYS NOTHING WAS ACCEPTED
--
-- `record_affiliate_click` promised, in its own comment, to refuse a click
-- that could never earn — so that a broken link fails when it is SHARED rather
-- than silently when somebody finally buys through it. It checked the product
-- was published and the affiliate's tier was high enough, but never that the
-- product has an active commission programme at all.
--
-- Without a programme, `attribute_order` returns null and the sale pays
-- nobody. The affiliate finds out after promoting it, from a conversion that
-- never appears.
-- ============================================================================

alter table public.affiliate_clicks
  alter column created_at set default clock_timestamp();

comment on column public.affiliate_clicks.created_at is
  'clock_timestamp(), not now(). A click is a wall-clock event and "last click wins" needs the order they actually happened in — now() is the transaction start and ties for every row in one transaction.';


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

  /* NEW: there has to be something to earn. A link to a product with no
     active programme pays nothing, and the affiliate would only discover that
     after promoting it. */
  if not exists (
    select 1 from public.affiliate_programs
     where product_id = p_product_id and status = 'active'
  ) then
    raise exception 'That product does not pay commission'
      using errcode = 'check_violation';
  end if;

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


/* The tie-break. Only reachable if two clicks share a microsecond, but an
   arbitrary winner in a money decision is worth one extra sort key. */
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

  select * into v_conversion from public.conversions where order_id = p_order_id;
  if found then
    return v_conversion;
  end if;

  if v_order.kind = 'training_renewal' then
    return null;
  end if;

  select * into v_program from public.affiliate_programs
   where product_id = v_order.product_id and status = 'active';
  if not found then
    return null;
  end if;

  select * into v_click
    from public.affiliate_clicks c
   where c.product_id = v_order.product_id
     and c.created_at > now() - make_interval(hours => v_program.attribution_window_hours)
     and (
       (p_visitor_token is not null and c.visitor_token = p_visitor_token)
       or c.user_id = v_order.user_id
     )
   order by c.created_at desc, c.id desc
   limit 1;

  if not found then
    return null;
  end if;

  select * into v_buyer from public.affiliate_accounts where user_id = v_order.user_id;
  if found and v_buyer.id = v_click.affiliate_id then
    return null;
  end if;

  select * into v_parent from public.affiliate_accounts
   where id = (select parent_affiliate_id from public.affiliate_accounts where id = v_click.affiliate_id);

  if found and v_parent.id is not null and v_parent.id <> v_click.affiliate_id then
    v_l2_depth := public.affiliate_depth_now(v_parent.id);
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
