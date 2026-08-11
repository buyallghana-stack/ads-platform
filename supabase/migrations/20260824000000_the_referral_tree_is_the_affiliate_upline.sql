-- ============================================================================
-- Migration 176 — a referral IS an affiliate upline
--
-- Operator, 2026-08-11: the admin account invited manager@assetsbridge.org,
-- manager recruited a buyer, the buyer bought training, manager was paid and
-- admin was not, "however admin is promised 2 level".
--
-- ── THE PLATFORM HAD TWO REFERRAL TREES THAT DID NOT TALK TO EACH OTHER ──
--
-- Phase 1 records a recruitment in `referrals`: a code typed at signup, a
-- referrer, and since migration 083 a second level. Phase 2 records one in
-- `affiliate_accounts.parent_affiliate_id`, and that column was only ever
-- written from ONE source: a click-attributed conversion on a training product
-- (`confirm_product_order`, the `v_conversion.affiliate_id` case).
--
-- So the only way to acquire an upline in the affiliate business was for
-- somebody to sell you your training through their own product link. Inviting
-- somebody with your referral code, which is what the Team tab and every
-- "invite" screen hands out, recorded nothing the commission code could see.
--
-- On the live project that is exactly what happened. `referrals` holds
-- admin → manager (code 3QN659SY, activated 04:01:55). Manager bought Beginner
-- at 04:03:34 and their affiliate account was created with a NULL parent. When
-- their own recruit bought Beginner at 04:39, `attribute_order` looked up
-- `parent_affiliate_id`, found nothing, and wrote the conversion with
-- `l2_affiliate_id` null. `pay_conversion_commissions` then never looked for a
-- second level, because there was none on the row to look for.
--
-- Nothing was wrong with admin: they hold Professional, and
-- `affiliate_depth_now` returns 2 for them. They qualified for the override
-- and the platform had simply never written down who they had recruited.
--
-- ── WHAT CHANGES ──
--
-- 1. `affiliate_upline_for(user)` answers "who recruited this person" from the
--    Phase 1 tree.
-- 2. `confirm_product_order` falls back to it when no click attributed the
--    sale. The click still wins where there is one: whoever actually sold the
--    training is the better answer, and it is the one the C22 record is built
--    from.
-- 3. The parent guard stops an upline being MOVED once it is set, which is the
--    freeze the old code got for free by never updating the column, and which
--    the repair below now needs to be explicit about.
-- 4. Existing accounts with no upline are repaired from the referral tree, and
--    the one conversion that was written before its upline was knowable is
--    reopened and paid.
--
-- ⚠️ POINT 4 IS A DELIBERATE EXCEPTION TO C22, TAKEN BY THE OPERATOR ON
-- 2026-08-11. C22 says level two is resolved at the moment of the sale and
-- never re-derived from entitlement history that has since moved. Re-deriving
-- it is precisely what the repair does, so it is written as a one-off block in
-- a migration rather than a function anybody can call again: there is no
-- reusable "recompute commissions" path added here, and there should not be.
-- The depth it stamps is TODAY'S depth, which for this data is the same as it
-- was at the sale, and the migration says so out loud rather than pretending
-- the number came from the past.
--
-- Why repair the conversion row rather than write an adjustment for GHS 7.50:
-- an adjustment is invisible to `reverse_conversion_commissions`. If that sale
-- were refunded, level one would be clawed back and a hand-written adjustment
-- would sit on the ledger forever as money paid on a sale that no longer
-- exists. Putting the level two fields where they belong means the refund path,
-- the statement, the vendor report and reconciliation all keep working.
-- ============================================================================


/* ---------------------------------------------------------------------------
   WHO RECRUITED THIS PERSON, per Phase 1.

   The FIRST non-rejected referral row, not the newest. `referrals` is keyed one
   row per referee so there should never be two, but if a repair ever leaves
   two the relationship that brought somebody in is the older one.

   `status` is deliberately not narrowed to 'activated'. A pending referral is
   still a recruitment: the status tracks whether Phase 1's activation BONUS has
   been earned, which is a different question from who brought whom.

   A suspended or lapsed upline is still returned. Whether they earn is decided
   at the sale by `affiliate_depth_now`, which requires an active account and a
   live entitlement, so a lapsed upline records depth 0 and is paid nothing
   while the relationship survives to answer a dispute.
--------------------------------------------------------------------------- */
create or replace function public.affiliate_upline_for(p_user_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select a.id
    from public.referrals r
    join public.affiliate_accounts a on a.user_id = r.referrer_id
   where r.referee_id = p_user_id
     and r.status <> 'rejected'
     and r.referrer_id <> p_user_id
   order by r.created_at
   limit 1;
$$;

revoke execute on function public.affiliate_upline_for(uuid) from public, anon, authenticated;
grant execute on function public.affiliate_upline_for(uuid) to service_role;


/* ---------------------------------------------------------------------------
   AN UPLINE IS SET ONCE.

   Nothing used to update this column, so "frozen at creation" held by accident.
   The repair at the bottom of this migration updates it, so the freeze has to
   become a rule rather than a habit before that runs: filling a NULL is
   allowed, changing a value that is already there is not.

   Moving an upline is not a cosmetic edit. It silently redirects every future
   override, and there is no audit trail on this table to say it happened.
--------------------------------------------------------------------------- */
create or replace function public.affiliate_parent_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_parents_parent uuid;
begin
  if tg_op = 'UPDATE'
     and old.parent_affiliate_id is not null
     and new.parent_affiliate_id is distinct from old.parent_affiliate_id then
    raise exception 'An upline is recorded once and cannot be moved'
      using errcode = 'check_violation';
  end if;

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


/* ---------------------------------------------------------------------------
   THE FALLBACK, in the one place an affiliate account is created.

   Unchanged from the live definition apart from the six lines marked below.
   The whole body is restated because that is how this repo edits a function,
   and because a money path is worse to read across three migrations than to
   read once.
--------------------------------------------------------------------------- */
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

            /* ── NEW: the referral tree, when no link sold this training. ──
               Somebody invited with a referral code is a recruit; nothing
               about that is less true because they reached the shop by typing
               the address. The click still wins above, because whoever sold
               the training is the more specific answer.

               `affiliate_upline_for` returns null for an organic signup, which
               leaves the column null, which is still correct: nobody recruited
               them. */
            if v_parent is null and v_order.kind = 'purchase' then
              v_parent := public.affiliate_upline_for(v_order.user_id);
            end if;

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

/* ⚠️ `create function` re-grants EXECUTE to PUBLIC. See migrations 103 and 104:
   seventeen functions were answering the publishable key because of exactly
   this. Confirming an order is service_role only. */
revoke execute on function public.confirm_product_order(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.confirm_product_order(uuid, text, text) to service_role;


/* ---------------------------------------------------------------------------
   THE REPAIR. One-off, and written as a rule rather than against three
   hardcoded ids so a fresh database runs it against nothing and says so.
--------------------------------------------------------------------------- */
do $$
declare
  v_linked  int := 0;
  v_paid    int := 0;
  v_minor   bigint := 0;
  r         record;
begin
  /* Accounts that were created before an upline could be recorded. Only NULL
     parents are touched: an account whose upline came from a real click keeps
     it, even where the Phase 1 tree disagrees. On the live project buyallghana
     is exactly that case, recruited by admin's code but sold their training by
     manager's link, and manager stays their upline because manager made the
     sale. */
  update public.affiliate_accounts a
     set parent_affiliate_id = public.affiliate_upline_for(a.user_id),
         updated_at          = now()
   where a.parent_affiliate_id is null
     and public.affiliate_upline_for(a.user_id) is not null;

  get diagnostics v_linked = row_count;

  /* Sales already made through an affiliate who has just acquired an upline.
     The rate is the programme's rate TODAY, not the rate at the sale, because
     nothing on the conversion recorded a second-level rate to restore. For the
     one row this touches they are the same 5%, and if that ever stops being
     true this block has already run once and will not run again. */
  for r in
    select c.id, c.base_minor, a.parent_affiliate_id as upline, ap.l2_rate_value as rate
      from public.conversions c
      join public.affiliate_accounts a on a.id = c.affiliate_id
      join public.affiliate_programs ap on ap.id = c.program_id
     where c.status = 'attributed'
       and c.l2_affiliate_id is null
       and a.parent_affiliate_id is not null
       and ap.l2_rate_value > 0
       and public.affiliate_depth_now(a.parent_affiliate_id) >= 2
  loop
    update public.conversions
       set l2_affiliate_id        = r.upline,
           l2_rate                = r.rate,
           l2_depth_at_conversion = public.affiliate_depth_now(r.upline),
           l2_entitlement_id      = (
             select e.id from public.affiliate_entitlements e
              where e.affiliate_id = r.upline
                and e.status = 'active'
                and e.grace_ends_at > now()
              order by e.commission_depth desc, e.expires_at desc
              limit 1
           )
     where id = r.id;

    /* Idempotent by `conversion:<id>:level:2`, so level one is not paid twice
       and re-running this block could not double anybody. */
    perform public.pay_conversion_commissions(r.id);

    v_paid  := v_paid + 1;
    v_minor := v_minor + round(r.base_minor * r.rate / 100.0);
  end loop;

  raise notice 'Uplines recorded from the referral tree: %. Conversions reopened: %, paying % minor units at level two.',
    v_linked, v_paid, v_minor;
end;
$$;
