-- ---------------------------------------------------------------------------
-- Commission rates become editable.
--
-- `affiliate_programs` has existed since Phase 2 started and has never had a
-- write path. Two rows were seeded by a migration — the two training
-- programmes — and the only admin function that touched the table was
-- `admin_list_products`, a READ.
--
-- So the catalogue could create a vendor product and the affiliate side could
-- display it, and there was no way to say what it pays. A product added
-- through the admin today gets no programme at all, which means `l1_rate` is
-- null, the affiliate cannot promote it and nobody can earn on it. The board
-- rendered that as a dash and moved on.
--
-- That is the gate on the whole marketplace: without it the only things an
-- affiliate can sell are the two training programmes, to each other, which is
-- precisely the shape the legal opinion was conditional about.
--
-- ── PERCENT ONLY, BECAUSE THE TABLE SAYS SO ──
--
-- `affiliate_programs_rate_types` requires both levels to be 'percent'. A
-- fixed-fee option would need that constraint changed and the conversion
-- arithmetic changed with it, so the editor offers what the schema allows and
-- nothing more. The other three constraints do real work too and the form
-- mirrors each one rather than restating it: 0-100 per level, the two together
-- at most 100, one programme per product.
--
-- ── CHANGING A RATE NEVER TOUCHES A SALE ALREADY MADE ──
--
-- `conversions` freezes `l1_rate` onto the row at attribution time, and the
-- ledger credit is computed from that frozen number. So this writes the rate
-- for FUTURE sales only, and nothing here can reach a commission somebody has
-- already been paid. The form says so out loud, because "did I just change
-- what I owe people" is the first question an operator will have.
-- ---------------------------------------------------------------------------

create or replace function public.admin_save_affiliate_program(
  p_admin_id     uuid,
  p_product_id   uuid,
  p_l1           numeric,
  p_l2           numeric,
  p_window_hours int default 720,
  p_hold_days    int default 0,
  p_active       boolean default true
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_exists boolean;
begin
  perform public.assert_admin(p_admin_id);

  if not exists (select 1 from public.products where id = p_product_id) then
    return jsonb_build_object('outcome', 'not_found');
  end if;

  /* Mirrored from the CHECK constraints so the operator gets a sentence rather
     than a constraint name. The constraints remain the guarantee. */
  if p_l1 is null or p_l1 < 0 or p_l1 > 100 then
    return jsonb_build_object('outcome', 'bad_l1');
  end if;
  if p_l2 is null or p_l2 < 0 or p_l2 > 100 then
    return jsonb_build_object('outcome', 'bad_l2');
  end if;
  if p_l1 + p_l2 > 100 then
    return jsonb_build_object('outcome', 'over_100');
  end if;
  if p_window_hours is null or p_window_hours <= 0 then
    return jsonb_build_object('outcome', 'bad_window');
  end if;
  if p_hold_days is null or p_hold_days < 0 then
    return jsonb_build_object('outcome', 'bad_hold');
  end if;

  select exists (select 1 from public.affiliate_programs where product_id = p_product_id)
    into v_exists;

  insert into public.affiliate_programs
    (product_id, l1_rate_type, l1_rate_value, l2_rate_type, l2_rate_value,
     attribution_window_hours, hold_days, status)
  values
    (p_product_id, 'percent', p_l1, 'percent', p_l2,
     p_window_hours, p_hold_days, case when p_active then 'active' else 'paused' end)
  on conflict (product_id) do update
     set l1_rate_value = excluded.l1_rate_value,
         l2_rate_value = excluded.l2_rate_value,
         attribution_window_hours = excluded.attribution_window_hours,
         hold_days = excluded.hold_days,
         status = excluded.status,
         updated_at = now();

  return jsonb_build_object('outcome', 'ok', 'created', not v_exists);
end;
$$;

/* Removing the programme entirely, which is not the same as setting 0%.
   0% is a product that pays nothing; NO programme is a product that is not in
   the affiliate marketplace at all and cannot be promoted. Both are things an
   operator legitimately wants and the difference matters on the shop card. */
create or replace function public.admin_remove_affiliate_program(
  p_admin_id   uuid,
  p_product_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform public.assert_admin(p_admin_id);

  /* ⚠️ Refused once anybody has earned on it. `conversions.program_id` is a
     plain foreign key, so the delete would either fail on the constraint or,
     worse, take the attribution history with it if that key ever gained a
     cascade. Pausing keeps the record and stops new sales. */
  if exists (
    select 1 from public.conversions c
      join public.affiliate_programs ap on ap.id = c.program_id
     where ap.product_id = p_product_id
  ) then
    return jsonb_build_object('outcome', 'has_sales');
  end if;

  delete from public.affiliate_programs where product_id = p_product_id;
  return jsonb_build_object('outcome', 'ok');
end;
$$;

-- ---------------------------------------------------------------------------
-- The list gains the three fields the editor needs to show what is set.
--
-- ⚠️ DROPPED FIRST. Postgres refuses `create or replace` when the RETURNS
-- TABLE signature changes ("cannot change return type of existing function"),
-- and the drop takes the grants with it, so both are restated below.
-- ---------------------------------------------------------------------------

drop function if exists public.admin_list_products(text);

create or replace function public.admin_list_products(p_purpose text default null)
returns table (
  id uuid, title text, slug text, kind text, purpose text, status text,
  vendor_name text, cover_path text, category text, description text,
  learning_outcomes text[], price_ghs numeric, sale_price_ghs numeric,
  effective_price_ghs numeric, content_language text, min_affiliate_tier text,
  lessons integer, sections integer, blockers integer,
  l1_rate numeric, l2_rate numeric,
  attribution_window_hours integer, hold_days integer, commission_status text,
  sales integer, revenue_ghs numeric, created_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.title, p.slug, p.kind::text, p.purpose::text, p.status::text,
         v.name,
         p.cover_path, p.category, p.description, p.learning_outcomes,
         (p.price_minor / 100.0)::numeric,
         (p.sale_price_minor / 100.0)::numeric,
         (public.product_price_minor(p.id) / 100.0)::numeric,
         p.content_language,
         p.min_affiliate_tier::text,
         (select count(*)::int from public.lessons l
            join public.course_sections s on s.id = l.section_id
           where s.product_id = p.id),
         (select count(*)::int from public.course_sections s where s.product_id = p.id),
         (select count(*)::int from public.product_publish_blockers(p.id)),
         ap.l1_rate_value,
         ap.l2_rate_value,
         ap.attribution_window_hours,
         ap.hold_days,
         ap.status,
         (select count(*)::int from public.orders o
           where o.product_id = p.id and o.status = 'confirmed'),
         (select coalesce(sum(o.amount_minor), 0) / 100.0 from public.orders o
           where o.product_id = p.id and o.status = 'confirmed')::numeric,
         p.created_at
    from public.products p
    left join public.vendors v on v.id = p.vendor_id
    left join public.affiliate_programs ap on ap.product_id = p.id
   where p_purpose is null or p.purpose::text = p_purpose
   order by p.created_at desc;
$$;

/* ⚠️ `create function` re-grants EXECUTE to PUBLIC, and the drop above threw
   the old grants away. Both halves restated for all three. */
revoke execute on function public.admin_list_products(text) from public, anon, authenticated;
grant execute on function public.admin_list_products(text) to service_role;

revoke execute on function public.admin_save_affiliate_program(uuid, uuid, numeric, numeric, int, int, boolean) from public, anon, authenticated;
grant execute on function public.admin_save_affiliate_program(uuid, uuid, numeric, numeric, int, int, boolean) to service_role;

revoke execute on function public.admin_remove_affiliate_program(uuid, uuid) from public, anon, authenticated;
grant execute on function public.admin_remove_affiliate_program(uuid, uuid) to service_role;
