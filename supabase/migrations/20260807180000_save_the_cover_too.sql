-- ============================================================================
-- Migration 142 — `admin_save_product` could not save a cover
--
-- Migration 140 added the bucket and the columns; this is the write path. Until
-- now `admin_save_product` never touched `cover_path`, `category` or
-- `learning_outcomes`, so the editor could offer an upload and the value would
-- vanish on save.
--
-- KEY PRESENCE, NOT COALESCE, for all three. `coalesce` cannot tell "leave it
-- alone" from "clear it", and all three are things an operator legitimately
-- removes: a cover gets taken down, a category gets emptied, an outcome list
-- gets cleared while it is rewritten. The same reasoning the sale price already
-- used, applied to the fields added since.
-- ============================================================================

create or replace function public.admin_save_product(p_admin_id uuid, p_product jsonb)
returns public.products
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id   uuid := nullif(p_product ->> 'id', '')::uuid;
  v_slug text := lower(btrim(coalesce(p_product ->> 'slug', '')));
  v_out  public.products;
  v_old  public.products;
  v_email text;
begin
  perform public.assert_admin(p_admin_id);

  if v_id is null then
    if v_slug !~ '^[a-z0-9][a-z0-9-]*$' then
      raise exception 'A product needs a short name in lowercase letters, like "sales-mastery"'
        using errcode = 'check_violation';
    end if;

    insert into public.products
      (vendor_id, kind, purpose, title, slug, description, content_language,
       price_minor, sale_price_minor, sale_starts_at, sale_ends_at,
       min_affiliate_tier, status, created_by, cover_path, category, learning_outcomes)
    values (
      nullif(p_product ->> 'vendorId', '')::uuid,
      (p_product ->> 'kind')::public.product_kind,
      coalesce((p_product ->> 'purpose')::public.product_purpose, 'vendor_product'),
      btrim(coalesce(p_product ->> 'title', '')),
      v_slug,
      nullif(btrim(coalesce(p_product ->> 'description', '')), ''),
      coalesce(nullif(p_product ->> 'contentLanguage', ''), 'en'),
      round(coalesce((p_product ->> 'priceGhs')::numeric, 0) * 100),
      case when p_product ? 'salePriceGhs'
           then round(nullif(p_product ->> 'salePriceGhs', '')::numeric * 100) end,
      nullif(p_product ->> 'saleStartsAt', '')::timestamptz,
      nullif(p_product ->> 'saleEndsAt', '')::timestamptz,
      coalesce((p_product ->> 'minAffiliateTier')::public.affiliate_tier, 'beginner'),
      'draft',
      p_admin_id,
      nullif(p_product ->> 'coverPath', ''),
      nullif(btrim(coalesce(p_product ->> 'category', '')), ''),
      coalesce(
        (select array_agg(btrim(value)) from jsonb_array_elements_text(
           case when jsonb_typeof(p_product -> 'outcomes') = 'array'
                then p_product -> 'outcomes' else '[]'::jsonb end)
          where btrim(value) <> ''),
        '{}'
      )
    )
    returning * into v_out;
    return v_out;
  end if;

  select * into v_old from public.products where id = v_id;
  if not found then
    raise exception 'Unknown product' using errcode = 'check_violation';
  end if;

  if v_slug <> '' and v_slug <> v_old.slug then
    raise exception 'A product''s short name cannot be changed once it exists'
      using errcode = 'check_violation';
  end if;

  update public.products set
    vendor_id        = case when p_product ? 'vendorId'
                            then nullif(p_product ->> 'vendorId', '')::uuid
                            else vendor_id end,
    title            = btrim(coalesce(p_product ->> 'title', title)),
    description      = nullif(btrim(coalesce(p_product ->> 'description', '')), ''),
    content_language = coalesce(nullif(p_product ->> 'contentLanguage', ''), content_language),
    price_minor      = round(coalesce((p_product ->> 'priceGhs')::numeric * 100, price_minor)),
    sale_price_minor = case when p_product ? 'salePriceGhs'
                            then round(nullif(p_product ->> 'salePriceGhs', '')::numeric * 100)
                            else sale_price_minor end,
    sale_starts_at   = case when p_product ? 'saleStartsAt'
                            then nullif(p_product ->> 'saleStartsAt', '')::timestamptz
                            else sale_starts_at end,
    sale_ends_at     = case when p_product ? 'saleEndsAt'
                            then nullif(p_product ->> 'saleEndsAt', '')::timestamptz
                            else sale_ends_at end,
    min_affiliate_tier = coalesce((p_product ->> 'minAffiliateTier')::public.affiliate_tier,
                                  min_affiliate_tier),

    /* The three added in migration 140. Key presence for every one: a cover is
       taken down, a category is emptied, an outcome list is cleared while it is
       being rewritten — and `coalesce` cannot express any of those. */
    cover_path       = case when p_product ? 'coverPath'
                            then nullif(p_product ->> 'coverPath', '')
                            else cover_path end,
    category         = case when p_product ? 'category'
                            then nullif(btrim(coalesce(p_product ->> 'category', '')), '')
                            else category end,
    learning_outcomes = case
                          when p_product ? 'outcomes' then coalesce(
                            (select array_agg(btrim(value))
                               from jsonb_array_elements_text(
                                 case when jsonb_typeof(p_product -> 'outcomes') = 'array'
                                      then p_product -> 'outcomes' else '[]'::jsonb end)
                              where btrim(value) <> ''),
                            '{}')
                          else learning_outcomes
                        end,

    updated_at       = now()
  where id = v_id
  returning * into v_out;

  /* Money changed hands over this figure. A price edit goes in the trail with
     the old value beside the new one. */
  if v_out.price_minor is distinct from v_old.price_minor
     or v_out.sale_price_minor is distinct from v_old.sale_price_minor then
    select u.email::text into v_email from auth.users u where u.id = p_admin_id;
    insert into public.admin_audit_log
      (actor_id, actor_email, action, entity_type, entity_id, old_values, new_values)
    values (
      p_admin_id, v_email, 'update', 'products', v_id,
      jsonb_build_object('price_minor', v_old.price_minor, 'sale_price_minor', v_old.sale_price_minor),
      jsonb_build_object('price_minor', v_out.price_minor, 'sale_price_minor', v_out.sale_price_minor)
    );
  end if;

  return v_out;
end;
$$;

revoke execute on function public.admin_save_product(uuid, jsonb) from public, anon, authenticated;
grant  execute on function public.admin_save_product(uuid, jsonb) to service_role;
