-- ============================================================================
-- Migration 123 — admin authoring: vendors, products, curriculum, quizzes
--
-- The RPCs every Affiliate Ops screen will call. Phase 1 has an `admin_*`
-- function per screen and Phase 2 had none, so nothing could be created except
-- by hand in SQL.
--
-- ---------------------------------------------------------------------------
-- EVERY ONE OF THESE CALLS `assert_admin`, WHICH IS SUPER-ADMIN ONLY
--
-- That looks heavy-handed for "edit a lesson title" until you follow what
-- content decides: completing a share of a training program ACTIVATES an
-- affiliate account (B9), and an active account earns money. Somebody who can
-- add a lesson can move the denominator; somebody who can delete one can move
-- it the other way. Authoring is money-adjacent, so it fails closed like the
-- rest of the money path.
--
-- Deletes are the sharp edge and they are refused rather than cascaded
-- wherever a learner has already touched the thing — see `admin_delete_lesson`.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Vendors
-- ---------------------------------------------------------------------------

create or replace function public.admin_save_vendor(p_admin_id uuid, p_vendor jsonb)
returns public.vendors
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id  uuid := nullif(p_vendor ->> 'id', '')::uuid;
  v_out public.vendors;
begin
  perform public.assert_admin(p_admin_id);

  if v_id is null then
    insert into public.vendors (name, contact_name, contact_email, contact_phone, notes, created_by)
    values (
      btrim(coalesce(p_vendor ->> 'name', '')),
      nullif(btrim(coalesce(p_vendor ->> 'contactName', '')), ''),
      nullif(btrim(coalesce(p_vendor ->> 'contactEmail', '')), ''),
      nullif(btrim(coalesce(p_vendor ->> 'contactPhone', '')), ''),
      nullif(btrim(coalesce(p_vendor ->> 'notes', '')), ''),
      p_admin_id
    )
    returning * into v_out;
    return v_out;
  end if;

  update public.vendors set
    name          = btrim(coalesce(p_vendor ->> 'name', name)),
    contact_name  = nullif(btrim(coalesce(p_vendor ->> 'contactName', '')), ''),
    contact_email = nullif(btrim(coalesce(p_vendor ->> 'contactEmail', '')), ''),
    contact_phone = nullif(btrim(coalesce(p_vendor ->> 'contactPhone', '')), ''),
    notes         = nullif(btrim(coalesce(p_vendor ->> 'notes', '')), ''),
    status        = coalesce((p_vendor ->> 'status')::public.vendor_status, status),
    updated_at    = now()
  where id = v_id
  returning * into v_out;

  if not found then
    raise exception 'Unknown vendor' using errcode = 'check_violation';
  end if;
  return v_out;
end;
$$;

create or replace function public.admin_list_vendors()
returns table (
  id uuid, name text, contact_name text, contact_email text, contact_phone text,
  status text, products int, created_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select v.id, v.name, v.contact_name, v.contact_email, v.contact_phone,
         v.status::text,
         (select count(*)::int from public.products p where p.vendor_id = v.id),
         v.created_at
    from public.vendors v
   order by v.name;
$$;


-- ---------------------------------------------------------------------------
-- 2. Products
-- ---------------------------------------------------------------------------
--
-- Price is in CEDIS on the way in and pesewas in the column, the same
-- convention the plan editor uses, because an admin form types money the way a
-- person says it.

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
       min_affiliate_tier, status, created_by)
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
      p_admin_id
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
    /* Key presence, not coalesce: null is how a form CLEARS a sale, and
       coalesce cannot express the difference between "clear it" and "leave it
       alone". Same reasoning as the plan editor's band ceiling. */
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


/*
  PUBLISHING IS THE ONE THAT REFUSES. `product_publish_blockers` already knows
  what is unfinished; this is where that knowledge is enforced, so a course
  cannot go on sale with a video that was never uploaded or a question nobody
  can answer.

  Unpublishing never refuses. Taking something off sale is what an operator
  does when something IS wrong, and a gate on the way out would trap them.
*/
create or replace function public.admin_set_product_status(
  p_admin_id uuid,
  p_product_id uuid,
  p_status public.product_status
)
returns public.products
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_out      public.products;
  v_blockers int;
  v_first    text;
  v_email    text;
begin
  perform public.assert_admin(p_admin_id);

  if p_status = 'published' then
    select count(*), min(problem) into v_blockers, v_first
      from public.product_publish_blockers(p_product_id);

    if v_blockers > 0 then
      raise exception 'Not ready to publish: % (and % more)', v_first, v_blockers - 1
        using errcode = 'check_violation';
    end if;
  end if;

  update public.products
     set status = p_status,
         published_at = case when p_status = 'published' then coalesce(published_at, now())
                             else published_at end,
         updated_at = now()
   where id = p_product_id
  returning * into v_out;

  if not found then
    raise exception 'Unknown product' using errcode = 'check_violation';
  end if;

  select u.email::text into v_email from auth.users u where u.id = p_admin_id;
  insert into public.admin_audit_log
    (actor_id, actor_email, action, entity_type, entity_id, new_values)
  values (p_admin_id, v_email, 'update', 'products', p_product_id,
          jsonb_build_object('status', p_status));

  return v_out;
end;
$$;


create or replace function public.admin_list_products(p_purpose text default null)
returns table (
  id uuid, title text, slug text, kind text, purpose text, status text,
  vendor_name text, price_ghs numeric, sale_price_ghs numeric, effective_price_ghs numeric,
  content_language text, min_affiliate_tier text,
  lessons int, sections int, blockers int,
  l1_rate numeric, l2_rate numeric,
  sales int, revenue_ghs numeric,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.title, p.slug, p.kind::text, p.purpose::text, p.status::text,
         v.name,
         (p.price_minor / 100.0)::numeric,
         (p.sale_price_minor / 100.0)::numeric,
         (public.product_price_minor(p.id) / 100.0)::numeric,
         p.content_language, p.min_affiliate_tier::text,
         (select count(*)::int from public.lessons l
            join public.course_sections s on s.id = l.section_id
           where s.product_id = p.id),
         (select count(*)::int from public.course_sections s where s.product_id = p.id),
         (select count(*)::int from public.product_publish_blockers(p.id)),
         ap.l1_rate_value, ap.l2_rate_value,
         (select count(*)::int from public.orders o
           where o.product_id = p.id and o.status = 'confirmed'),
         coalesce((select sum(o.amount_minor)::numeric / 100 from public.orders o
                    where o.product_id = p.id and o.status = 'confirmed'), 0),
         p.created_at
    from public.products p
    left join public.vendors v on v.id = p.vendor_id
    left join public.affiliate_programs ap on ap.product_id = p.id
   where p_purpose is null or p.purpose::text = p_purpose
   order by p.created_at desc;
$$;


-- ---------------------------------------------------------------------------
-- 3. Curriculum
-- ---------------------------------------------------------------------------

create or replace function public.admin_save_section(p_admin_id uuid, p_section jsonb)
returns public.course_sections
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id  uuid := nullif(p_section ->> 'id', '')::uuid;
  v_out public.course_sections;
begin
  perform public.assert_admin(p_admin_id);

  if v_id is null then
    insert into public.course_sections (product_id, title, position)
    values (
      (p_section ->> 'productId')::uuid,
      btrim(coalesce(p_section ->> 'title', '')),
      coalesce((p_section ->> 'position')::int,
               (select coalesce(max(position), -1) + 1 from public.course_sections
                 where product_id = (p_section ->> 'productId')::uuid))
    )
    returning * into v_out;
    return v_out;
  end if;

  update public.course_sections
     set title = btrim(coalesce(p_section ->> 'title', title)),
         position = coalesce((p_section ->> 'position')::int, position)
   where id = v_id
  returning * into v_out;

  if not found then
    raise exception 'Unknown section' using errcode = 'check_violation';
  end if;
  return v_out;
end;
$$;


create or replace function public.admin_save_lesson(p_admin_id uuid, p_lesson jsonb)
returns public.lessons
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id  uuid := nullif(p_lesson ->> 'id', '')::uuid;
  v_out public.lessons;
begin
  perform public.assert_admin(p_admin_id);

  if v_id is null then
    insert into public.lessons
      (section_id, kind, title, position, body, storage_path, duration_seconds, is_preview)
    values (
      (p_lesson ->> 'sectionId')::uuid,
      coalesce((p_lesson ->> 'kind')::public.lesson_kind, 'video'),
      btrim(coalesce(p_lesson ->> 'title', '')),
      coalesce((p_lesson ->> 'position')::int,
               (select coalesce(max(position), -1) + 1 from public.lessons
                 where section_id = (p_lesson ->> 'sectionId')::uuid)),
      nullif(btrim(coalesce(p_lesson ->> 'body', '')), ''),
      nullif(btrim(coalesce(p_lesson ->> 'storagePath', '')), ''),
      coalesce((p_lesson ->> 'durationSeconds')::int, 0),
      coalesce((p_lesson ->> 'isPreview')::boolean, false)
    )
    returning * into v_out;
    return v_out;
  end if;

  update public.lessons set
    kind             = coalesce((p_lesson ->> 'kind')::public.lesson_kind, kind),
    title            = btrim(coalesce(p_lesson ->> 'title', title)),
    position         = coalesce((p_lesson ->> 'position')::int, position),
    body             = case when p_lesson ? 'body'
                            then nullif(btrim(coalesce(p_lesson ->> 'body', '')), '')
                            else body end,
    /* Key presence again: the upload finishes AFTER the row is created, and
       this is the call that attaches the file. */
    storage_path     = case when p_lesson ? 'storagePath'
                            then nullif(btrim(coalesce(p_lesson ->> 'storagePath', '')), '')
                            else storage_path end,
    duration_seconds = coalesce((p_lesson ->> 'durationSeconds')::int, duration_seconds),
    is_preview       = coalesce((p_lesson ->> 'isPreview')::boolean, is_preview)
  where id = v_id
  returning * into v_out;

  if not found then
    raise exception 'Unknown lesson' using errcode = 'check_violation';
  end if;
  return v_out;
end;
$$;


/*
  DELETING IS REFUSED ONCE ANYBODY HAS TOUCHED IT.

  `lesson_progress` cascades, so a delete would silently remove somebody's
  completion — and completion is the denominator that decides who is an
  affiliate. An admin tidying a curriculum should not be able to change who may
  earn money without being told.

  The way out is to unpublish the product and rebuild, or to leave the lesson
  and edit it. Both are visible; a cascade is not.
*/
create or replace function public.admin_delete_lesson(p_admin_id uuid, p_lesson_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_touched int;
begin
  perform public.assert_admin(p_admin_id);

  select count(*) into v_touched from public.lesson_progress where lesson_id = p_lesson_id;
  if v_touched > 0 then
    raise exception '% learner(s) have already started this lesson — edit it instead of deleting it',
      v_touched using errcode = 'check_violation';
  end if;

  delete from public.lessons where id = p_lesson_id;
end;
$$;


create or replace function public.admin_delete_section(p_admin_id uuid, p_section_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_touched int;
begin
  perform public.assert_admin(p_admin_id);

  select count(*) into v_touched
    from public.lesson_progress lp
    join public.lessons l on l.id = lp.lesson_id
   where l.section_id = p_section_id;

  if v_touched > 0 then
    raise exception 'Learners have already started lessons in this section'
      using errcode = 'check_violation';
  end if;

  delete from public.course_sections where id = p_section_id;
end;
$$;


/* Reordering is ONE call taking the ids in their new order, not one call per
   item. A drag-and-drop list that saves item by item leaves the curriculum
   half-reordered whenever the network drops. */
create or replace function public.admin_reorder_lessons(
  p_admin_id uuid,
  p_section_id uuid,
  p_lesson_ids uuid[]
)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare v_moved int;
begin
  perform public.assert_admin(p_admin_id);

  update public.lessons l
     set position = ordering.idx - 1
    from unnest(p_lesson_ids) with ordinality as ordering(id, idx)
   where l.id = ordering.id and l.section_id = p_section_id;

  get diagnostics v_moved = row_count;
  return v_moved;
end;
$$;


create or replace function public.admin_reorder_sections(
  p_admin_id uuid,
  p_product_id uuid,
  p_section_ids uuid[]
)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare v_moved int;
begin
  perform public.assert_admin(p_admin_id);

  update public.course_sections s
     set position = ordering.idx - 1
    from unnest(p_section_ids) with ordinality as ordering(id, idx)
   where s.id = ordering.id and s.product_id = p_product_id;

  get diagnostics v_moved = row_count;
  return v_moved;
end;
$$;


-- ---------------------------------------------------------------------------
-- 4. Resources
-- ---------------------------------------------------------------------------

create or replace function public.admin_save_resource(p_admin_id uuid, p_resource jsonb)
returns public.lesson_resources
language plpgsql
security definer
set search_path = ''
as $$
declare v_out public.lesson_resources;
begin
  perform public.assert_admin(p_admin_id);

  insert into public.lesson_resources (lesson_id, title, storage_path, byte_size, position)
  values (
    (p_resource ->> 'lessonId')::uuid,
    btrim(coalesce(p_resource ->> 'title', '')),
    btrim(coalesce(p_resource ->> 'storagePath', '')),
    nullif(p_resource ->> 'byteSize', '')::bigint,
    coalesce((p_resource ->> 'position')::int,
             (select coalesce(max(position), -1) + 1 from public.lesson_resources
               where lesson_id = (p_resource ->> 'lessonId')::uuid))
  )
  returning * into v_out;
  return v_out;
end;
$$;

create or replace function public.admin_delete_resource(p_admin_id uuid, p_resource_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.assert_admin(p_admin_id);
  delete from public.lesson_resources where id = p_resource_id;
end;
$$;


-- ---------------------------------------------------------------------------
-- 5. Quizzes, authored a question at a time
-- ---------------------------------------------------------------------------
--
-- A question and its options are saved TOGETHER, in one call. The editor
-- treats a question as a unit — prompt plus its answers — and three separate
-- calls would let a save half-land: a prompt with no options, or options with
-- no correct answer, which `lesson_is_ready` would then rightly refuse to
-- publish while the admin wonders what they did wrong.

create or replace function public.admin_save_quiz(p_admin_id uuid, p_quiz jsonb)
returns public.quizzes
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id  uuid := nullif(p_quiz ->> 'id', '')::uuid;
  v_out public.quizzes;
begin
  perform public.assert_admin(p_admin_id);

  if v_id is null then
    insert into public.quizzes (lesson_id, title, at_seconds, pass_percent, position)
    values (
      (p_quiz ->> 'lessonId')::uuid,
      coalesce(nullif(btrim(coalesce(p_quiz ->> 'title', '')), ''), 'Quiz'),
      nullif(p_quiz ->> 'atSeconds', '')::int,
      coalesce((p_quiz ->> 'passPercent')::int, 70),
      coalesce((p_quiz ->> 'position')::int, 0)
    )
    returning * into v_out;
    return v_out;
  end if;

  update public.quizzes set
    title        = coalesce(nullif(btrim(coalesce(p_quiz ->> 'title', '')), ''), title),
    at_seconds   = case when p_quiz ? 'atSeconds'
                        then nullif(p_quiz ->> 'atSeconds', '')::int else at_seconds end,
    pass_percent = coalesce((p_quiz ->> 'passPercent')::int, pass_percent),
    position     = coalesce((p_quiz ->> 'position')::int, position)
  where id = v_id
  returning * into v_out;

  if not found then
    raise exception 'Unknown quiz' using errcode = 'check_violation';
  end if;
  return v_out;
end;
$$;


create or replace function public.admin_save_quiz_question(
  p_admin_id uuid,
  p_question jsonb        -- { id?, quizId, prompt, explanation?, position?,
                          --   options: [{ body, isCorrect }] }
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id      uuid := nullif(p_question ->> 'id', '')::uuid;
  v_option  jsonb;
  v_index   int := 0;
  v_correct int;
begin
  perform public.assert_admin(p_admin_id);

  if jsonb_typeof(p_question -> 'options') <> 'array'
     or jsonb_array_length(p_question -> 'options') < 2 then
    raise exception 'A question needs at least two options' using errcode = 'check_violation';
  end if;

  select count(*) into v_correct
    from jsonb_array_elements(p_question -> 'options') o
   where (o ->> 'isCorrect')::boolean;

  if v_correct = 0 then
    raise exception 'A question needs a correct answer' using errcode = 'check_violation';
  end if;

  if v_id is null then
    insert into public.quiz_questions (quiz_id, prompt, explanation, position)
    values (
      (p_question ->> 'quizId')::uuid,
      btrim(coalesce(p_question ->> 'prompt', '')),
      nullif(btrim(coalesce(p_question ->> 'explanation', '')), ''),
      coalesce((p_question ->> 'position')::int,
               (select coalesce(max(position), -1) + 1 from public.quiz_questions
                 where quiz_id = (p_question ->> 'quizId')::uuid))
    )
    returning id into v_id;
  else
    update public.quiz_questions set
      prompt      = btrim(coalesce(p_question ->> 'prompt', prompt)),
      explanation = nullif(btrim(coalesce(p_question ->> 'explanation', '')), ''),
      position    = coalesce((p_question ->> 'position')::int, position)
    where id = v_id;

    if not found then
      raise exception 'Unknown question' using errcode = 'check_violation';
    end if;

    /* Options are REPLACED, not merged. A question's answers are edited as a
       set — merging would leave an option somebody removed still sitting there
       and still markable. */
    delete from public.quiz_options where question_id = v_id;
  end if;

  for v_option in select * from jsonb_array_elements(p_question -> 'options') loop
    insert into public.quiz_options (question_id, position, body, is_correct)
    values (v_id, v_index, btrim(coalesce(v_option ->> 'body', '')),
            coalesce((v_option ->> 'isCorrect')::boolean, false));
    v_index := v_index + 1;
  end loop;

  return v_id;
end;
$$;


create or replace function public.admin_delete_quiz_question(p_admin_id uuid, p_question_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.assert_admin(p_admin_id);
  delete from public.quiz_questions where id = p_question_id;
end;
$$;


/* The curriculum as the AUTHOR sees it — the same shape the learner's list
   has, plus what is unfinished. One call behind the authoring screen. */
create or replace function public.admin_course_curriculum(p_product_id uuid)
returns table (
  section_id uuid, section_title text, section_position int,
  lesson_id uuid, lesson_title text, lesson_position int, kind text,
  duration_seconds int, is_preview bool,
  resource_count int, quiz_count int, question_count int,
  learners_started int, problem text
)
language sql
stable
security definer
set search_path = ''
as $$
  select s.id, s.title, s.position,
         l.id, l.title, l.position, l.kind::text,
         l.duration_seconds, l.is_preview,
         (select count(*)::int from public.lesson_resources r where r.lesson_id = l.id),
         (select count(*)::int from public.quizzes q where q.lesson_id = l.id),
         (select count(*)::int from public.quiz_questions qq
            join public.quizzes q on q.id = qq.quiz_id where q.lesson_id = l.id),
         (select count(*)::int from public.lesson_progress lp where lp.lesson_id = l.id),
         public.lesson_is_ready(l.id)
    from public.course_sections s
    left join public.lessons l on l.section_id = s.id
   where s.product_id = p_product_id
   order by s.position, l.position;
$$;


-- ---------------------------------------------------------------------------
-- 6. Grants
-- ---------------------------------------------------------------------------
--
-- Service role only, every one. The admin console reaches these through the
-- service client after its own session check, and `assert_admin` checks again
-- inside. Today's lesson about `create function` handing EXECUTE to PUBLIC is
-- why the revokes are written out rather than assumed.

do $$
declare
  v_sig text;
begin
  foreach v_sig in array array[
    'public.admin_save_vendor(uuid, jsonb)',
    'public.admin_list_vendors()',
    'public.admin_save_product(uuid, jsonb)',
    'public.admin_set_product_status(uuid, uuid, public.product_status)',
    'public.admin_list_products(text)',
    'public.admin_save_section(uuid, jsonb)',
    'public.admin_save_lesson(uuid, jsonb)',
    'public.admin_delete_lesson(uuid, uuid)',
    'public.admin_delete_section(uuid, uuid)',
    'public.admin_reorder_lessons(uuid, uuid, uuid[])',
    'public.admin_reorder_sections(uuid, uuid, uuid[])',
    'public.admin_save_resource(uuid, jsonb)',
    'public.admin_delete_resource(uuid, uuid)',
    'public.admin_save_quiz(uuid, jsonb)',
    'public.admin_save_quiz_question(uuid, jsonb)',
    'public.admin_delete_quiz_question(uuid, uuid)',
    'public.admin_course_curriculum(uuid)'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated', v_sig);
    execute format('grant execute on function %s to service_role', v_sig);
  end loop;
end $$;
