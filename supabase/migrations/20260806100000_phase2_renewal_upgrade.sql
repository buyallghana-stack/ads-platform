-- ============================================================================
-- Migration 121 — renewing training, and upgrading Beginner to Professional
--
-- Gate G4, approved by the Owner on 2026-08-06 with all three recommendations
-- taken: extend from the later of the current expiry and today, credit what
-- was ACTUALLY PAID for Beginner, and pay an upgrade's commission to the
-- upline rather than to the last click.
--
-- The `order_kind` enum has carried `training_renewal` and `training_upgrade`
-- since migration 109 and nothing could create either. Attribution has refused
-- to pay on a renewal since 112. This is the other half.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Renewing
-- ---------------------------------------------------------------------------

create or replace function public.start_training_renewal(
  p_user_id uuid,
  p_training_program_id uuid,
  p_method public.order_payment_method
)
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile  public.profiles;
  v_training public.training_programs;
  v_product  public.products;
  v_account  public.affiliate_accounts;
  v_entitle  public.affiliate_entitlements;
  v_amount   bigint;
  v_row      public.orders;
begin
  select * into v_profile from public.profiles where id = p_user_id;
  if not found then
    raise exception 'Unknown user' using errcode = 'check_violation';
  end if;
  if v_profile.disabled_at is not null then
    raise exception 'This account is disabled' using errcode = 'check_violation';
  end if;

  select * into v_training from public.training_programs where id = p_training_program_id;
  if not found then
    raise exception 'Unknown training program' using errcode = 'check_violation';
  end if;

  select * into v_product from public.products where id = v_training.product_id;

  select * into v_account from public.affiliate_accounts where user_id = p_user_id;
  if not found then
    raise exception 'You have not bought this training' using errcode = 'check_violation';
  end if;

  /* A renewal extends something. Without an entitlement there is nothing to
     extend, and what they want is the ordinary purchase path — which also
     creates the affiliate account and freezes an upline, neither of which a
     renewal may do. */
  select * into v_entitle from public.affiliate_entitlements
   where affiliate_id = v_account.id and training_program_id = p_training_program_id;
  if not found then
    raise exception 'You have not bought this training' using errcode = 'check_violation';
  end if;

  /* The renewal price, or the product's own if the Owner has not set one. */
  v_amount := coalesce(v_training.renewal_price_minor, public.product_price_minor(v_product.id));

  insert into public.orders
    (user_id, product_id, kind, amount_minor, list_price_minor, method, status)
  values
    (p_user_id, v_product.id, 'training_renewal', v_amount, v_product.price_minor, p_method, 'pending')
  returning * into v_row;

  return v_row;
end;
$$;

revoke execute on function public.start_training_renewal(uuid, uuid, public.order_payment_method)
  from public, anon, authenticated;
grant execute on function public.start_training_renewal(uuid, uuid, public.order_payment_method)
  to service_role;


-- ---------------------------------------------------------------------------
-- 2. Upgrading
-- ---------------------------------------------------------------------------
--
-- An upgrade needs no new entitlement machinery. It is an order for the
-- PROFESSIONAL product priced at the difference; confirming it grants a second
-- affiliate entitlement beside the Beginner one, and `affiliate_depth_now`
-- already takes the maximum — so depth goes 1 to 2 on its own. They get the
-- Professional course content too, which is right: they paid for it.
--
-- THE CREDIT IS WHAT THEY ACTUALLY PAID, read off their Beginner order rather
-- than today's list price. If Beginner cost GHS 150 when they bought it and
-- costs GHS 200 now, crediting the list price hands them GHS 50 they never
-- spent — and it would drift every time the Owner re-prices.

create or replace function public.start_training_upgrade(
  p_user_id uuid,
  p_target_program_id uuid,
  p_method public.order_payment_method
)
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile   public.profiles;
  v_target    public.training_programs;
  v_product   public.products;
  v_account   public.affiliate_accounts;
  v_held      int;
  v_credit    bigint;
  v_amount    bigint;
  v_row       public.orders;
begin
  select * into v_profile from public.profiles where id = p_user_id;
  if not found then
    raise exception 'Unknown user' using errcode = 'check_violation';
  end if;
  if v_profile.disabled_at is not null then
    raise exception 'This account is disabled' using errcode = 'check_violation';
  end if;

  select * into v_target from public.training_programs where id = p_target_program_id;
  if not found then
    raise exception 'Unknown training program' using errcode = 'check_violation';
  end if;

  select * into v_account from public.affiliate_accounts where user_id = p_user_id;
  if not found then
    raise exception 'You have no training to upgrade from' using errcode = 'check_violation';
  end if;

  -- Already at this depth or above? There is nothing to sell them.
  select coalesce(max(e.commission_depth), 0) into v_held
    from public.affiliate_entitlements e
   where e.affiliate_id = v_account.id and e.status = 'active';

  if v_held = 0 then
    raise exception 'You have no training to upgrade from' using errcode = 'check_violation';
  end if;
  if v_held >= v_target.commission_depth then
    raise exception 'You already hold that training or better' using errcode = 'check_violation';
  end if;

  select * into v_product from public.products where id = v_target.product_id;
  if v_product.status <> 'published' then
    raise exception 'That product is not on sale' using errcode = 'check_violation';
  end if;

  /* What they paid for what they already hold. Their order, not the price
     list — see the note above. Several entitlements would mean several orders,
     so the dearest one is credited: it is the one they would feel losing. */
  select coalesce(max(o.amount_minor), 0) into v_credit
    from public.affiliate_entitlements e
    join public.orders o on o.id = e.order_id
   where e.affiliate_id = v_account.id and e.status = 'active';

  v_amount := greatest(public.product_price_minor(v_product.id) - v_credit, 0);

  insert into public.orders
    (user_id, product_id, kind, amount_minor, list_price_minor, method, status)
  values
    (p_user_id, v_product.id, 'training_upgrade', v_amount, v_product.price_minor, p_method, 'pending')
  returning * into v_row;

  return v_row;
end;
$$;

revoke execute on function public.start_training_upgrade(uuid, uuid, public.order_payment_method)
  from public, anon, authenticated;
grant execute on function public.start_training_upgrade(uuid, uuid, public.order_payment_method)
  to service_role;


-- ---------------------------------------------------------------------------
-- 3. Who earns on an upgrade
-- ---------------------------------------------------------------------------
--
-- B8: the upgrade pays the SAME UPLINE. That is a deliberate detour around
-- last-click attribution, and the reason is an exploit rather than a
-- preference: an upgrade needs no click at all, so under the normal rule
-- somebody could open a friend's link first and move their own upgrade
-- commission to whoever they liked.
--
-- So level one is the buyer's recruiter, and level two is that person's own
-- recruiter — the same two-hop shape as any other sale, with the seller being
-- the person who brought them in.
--
-- A renewal still leaves before anything is written (B11c). It is the one
-- order kind that pays nobody at any level.

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
  v_earner     uuid;
  v_click_id   uuid;
  v_subid      text;
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

  -- B11c. Pays nobody, at any level, and leaves before anything is written.
  if v_order.kind = 'training_renewal' then
    return null;
  end if;

  select * into v_program from public.affiliate_programs
   where product_id = v_order.product_id and status = 'active';
  if not found then
    return null;
  end if;

  select * into v_buyer from public.affiliate_accounts where user_id = v_order.user_id;

  if v_order.kind = 'training_upgrade' then
    /* No click. The earner is whoever recruited them, if that person may
       still earn at all — a lapsed upline gets nothing, the same rule that
       governs an override. */
    if v_buyer.id is null or v_buyer.parent_affiliate_id is null then
      return null;
    end if;
    if public.affiliate_depth_now(v_buyer.parent_affiliate_id) < 1 then
      return null;
    end if;
    v_earner   := v_buyer.parent_affiliate_id;
    v_click_id := null;
    v_subid    := null;
  else
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

    v_earner   := v_click.affiliate_id;
    v_click_id := v_click.id;
    v_subid    := v_click.subid;
  end if;

  -- Self-referral, whichever route got here.
  if v_buyer.id is not null and v_buyer.id = v_earner then
    return null;
  end if;

  -- ---- C22: resolve level two NOW, and write down what was true ----------
  select * into v_parent from public.affiliate_accounts
   where id = (select parent_affiliate_id from public.affiliate_accounts where id = v_earner);

  if found and v_parent.id is not null and v_parent.id <> v_earner then
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
    (p_order_id, v_earner, v_click_id, v_subid, v_program.id,
     v_program.l1_rate_value, v_l2_id, v_l2_rate, v_l2_ent, v_l2_depth,
     v_order.amount_minor)
  returning * into v_conversion;

  return v_conversion;
end;
$$;

revoke execute on function public.attribute_order(uuid, text) from public, anon, authenticated;
grant execute on function public.attribute_order(uuid, text) to service_role;


-- ---------------------------------------------------------------------------
-- 4. Confirming a renewal or an upgrade
-- ---------------------------------------------------------------------------
--
-- Replaces migration 115's version. Three kinds now, and they diverge exactly
-- where they should:
--
--   purchase          creates the affiliate account, freezes the upline,
--                     grants the entitlement
--   training_upgrade  grants a SECOND entitlement beside the first, so depth
--                     rises on its own. No account is created; the upline is
--                     already frozen and must not move.
--   training_renewal  extends the entitlement it already has. Nothing else.

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
  v_from       timestamptz;
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
    if v_conversion.id is not null then
      perform public.pay_conversion_commissions(v_conversion.id);
    end if;

    select * into v_product from public.products where id = v_order.product_id;

    if v_product.purpose = 'training_program' then
      select * into v_training from public.training_programs where product_id = v_product.id;

      if found then
        select * into v_account from public.affiliate_accounts where user_id = v_order.user_id;

        if v_order.kind = 'training_renewal' then
          /* Extended from the LATER of the current expiry and today, so
             renewing early does not cost the days already paid for. Always
             from today would quietly punish whoever renews on time. */
          if v_account.id is not null then
            update public.affiliate_entitlements e
               set expires_at    = greatest(e.expires_at, now())
                                     + make_interval(days => v_training.validity_days),
                   grace_ends_at = greatest(e.expires_at, now())
                                     + make_interval(days => v_training.validity_days)
                                     + make_interval(days => v_training.grace_days),
                   status        = 'active',
                   order_id      = v_order.id,
                   updated_at    = now()
             where e.affiliate_id = v_account.id
               and e.training_program_id = v_training.id;
          end if;

        else
          -- purchase and training_upgrade
          if not found or v_account.id is null then
            /* Only a first purchase creates an account and freezes an upline.
               An upgrade cannot reach here — it refuses without one. */
            v_parent := case
                          when v_conversion.id is not null and v_order.kind = 'purchase'
                            then v_conversion.affiliate_id
                          else null
                        end;

            insert into public.affiliate_accounts (user_id, affiliate_code, status, parent_affiliate_id)
            values (v_order.user_id, public.generate_affiliate_code(), 'pending', v_parent)
            returning * into v_account;
          end if;

          v_from    := v_order.confirmed_at;
          v_expires := v_from + make_interval(days => v_training.validity_days);

          insert into public.affiliate_entitlements
            (affiliate_id, training_program_id, order_id, commission_depth,
             starts_at, expires_at, grace_ends_at, status)
          values
            (v_account.id, v_training.id, v_order.id, v_training.commission_depth,
             v_from, v_expires,
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
    end if;
  exception when others then
    insert into public.system_alerts (severity, code, message, context)
    values (
      'high', 'entitlement_grant_failed',
      'An order was paid but its access or commission could not be granted.',
      jsonb_build_object('order_id', p_order_id, 'error', sqlerrm)
    );
  end;

  return v_order;
end;
$$;

revoke execute on function public.confirm_product_order(uuid, text, text) from public, anon, authenticated;
grant execute on function public.confirm_product_order(uuid, text, text) to service_role;
