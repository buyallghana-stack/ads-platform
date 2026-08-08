-- ---------------------------------------------------------------------------
-- Four reads change shape (operator, 2026-08-08):
--
--   1. A free preview lesson has to be openable, so the product page needs the
--      lesson's ID. It only ever had the title.
--   2. Learn shows COURSES — not started, in progress, finished — and no
--      certificates, so it needs the finished ones too.
--   3. A training programme somebody already owns must stop being offered, and
--      Beginner must vanish once Professional is bought.
--   4. Owning Beginner should offer an upgrade to Professional.
-- ---------------------------------------------------------------------------

-- ── 1. The product page can link a preview ────────────────────────────────
--
-- ⚠️ THE PREVIEW BADGE WAS A `<span>`, and it could not have been anything
-- else: `shop_product` returned a lesson as title / kind / seconds / preview
-- and no identifier, so the page had nothing to link TO. The badge said "Free
-- preview" and there was no way to watch it.
--
-- Nothing about who may watch what changes here. `lesson_for_learner` already
-- allows exactly `is_preview or has_entitlement(...)`, so a preview opens for
-- anybody and every other lesson in the course still refuses. The ID is not a
-- key to the course; it is a key to the one lesson that was already public.

/*
  Applied as a targeted patch of the LIVE definition rather than a retyped
  copy — the body is forty lines of assembly and re-typing it to add one key is
  how a copy and its original drift apart. The equivalent of:

    replace(pg_get_functiondef('shop_product'),
            "jsonb_build_object('title', l.title,",
            "jsonb_build_object('id', l.id, 'title', l.title,")

  and the DO block raises if the block does not match, so a silent no-op is not
  a possible outcome.
*/
do $do$
declare v_def text; v_new text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'shop_product';

  v_new := replace(
    v_def,
    'select jsonb_agg(jsonb_build_object(
                              ''title'',    l.title,',
    'select jsonb_agg(jsonb_build_object(
                              ''id'',       l.id,
                              ''title'',    l.title,'
  );

  if v_new = v_def then
    raise exception 'shop_product: the lessons block did not match, nothing changed';
  end if;

  execute v_new;
end
$do$;

revoke execute on function public.shop_product(text, uuid) from public, anon, authenticated;
grant execute on function public.shop_product(text, uuid) to service_role;

-- ── 2. Learn is a list of courses, in three states ────────────────────────
--
-- `ongoing` deliberately excluded finished courses, on the reasoning that a
-- completed row is a trophy and the certificate list already held it. The
-- certificates are moving to the profile, so that reasoning goes with them:
-- Learn is now the place a course lives from the day it is bought.

create or replace function public.my_learning(p_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'certificates', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id',           c.id,
               'productId',    p.id,
               'slug',         p.slug,
               'title',        p.title,
               'coverPath',    p.cover_path,
               'category',     p.category,
               'grade',        c.grade_percent,
               'issuedAt',     c.issued_at,
               'code',         c.verification_code,
               'instructor',   coalesce(v.display_name, v.name)
             ) order by c.issued_at desc)
        from public.certificates c
        join public.products p on p.id = c.product_id
        left join public.vendors v on v.id = p.vendor_id
       where c.user_id = p_user_id
    ), '[]'::jsonb),

    /* EVERY owned course, whatever its state. The UI buckets it; the database
       reports it, which is the split that stops "what counts as ongoing" from
       being answered in two places. */
    'courses', coalesce((
      select jsonb_agg(x order by x->>'percent', x->>'title')
        from (
          select jsonb_build_object(
                   'productId',  p.id,
                   'slug',       p.slug,
                   'title',      p.title,
                   'description', p.description,
                   'coverPath',  p.cover_path,
                   'category',   p.category,
                   'instructor', coalesce(v.display_name, v.name),
                   'percent',    public.training_completion_percent(p_user_id, p.id),
                   'lessons',    (select count(*)::int from public.lessons l
                                    join public.course_sections s on s.id = l.section_id
                                   where s.product_id = p.id),
                   'lessonsLeft', (
                     select count(*)::int
                       from public.lessons l
                       join public.course_sections s on s.id = l.section_id
                      where s.product_id = p.id
                        and not exists (
                          select 1 from public.lesson_progress lp
                           where lp.lesson_id = l.id
                             and lp.user_id = p_user_id
                             and lp.completed_at is not null
                        )
                   )
                 ) as x
            from public.entitlements e
            join public.products p on p.id = e.product_id
            left join public.vendors v on v.id = p.vendor_id
           where e.user_id = p_user_id
        ) t
    ), '[]'::jsonb)
  );
$$;

revoke execute on function public.my_learning(uuid) from public, anon, authenticated;
grant execute on function public.my_learning(uuid) to service_role;

-- ── 3 & 4. What is still worth offering, and what an upgrade would be ─────
--
-- A programme somebody already owns is not an offer, and Beginner stops being
-- one the moment Professional is bought — Professional contains it. The
-- levels are ordered, so this is "nothing at or below what you already hold".

create or replace function public.training_level_rank(p_level text)
returns int
language sql
immutable
set search_path = ''
as $$
  select case p_level when 'beginner' then 1 when 'professional' then 2 else 0 end;
$$;

/**
 * The highest training level this person owns, or 0.
 *
 * Reads `entitlements`, not `affiliate_entitlements`: the first is the record
 * of the PURCHASE and never expires, the second is the right to earn and does.
 * Somebody whose affiliate entitlement lapsed still bought the course, and
 * re-offering it to them would be selling it twice.
 */
create or replace function public.owned_training_rank(p_user_id uuid)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(max(public.training_level_rank(tp.level::text)), 0)
    from public.entitlements e
    join public.training_programs tp on tp.product_id = e.product_id
   where e.user_id = p_user_id;
$$;

revoke execute on function public.owned_training_rank(uuid) from public, anon, authenticated;
grant execute on function public.owned_training_rank(uuid) to service_role;

/** The one programme worth buying next, or null when there is none. */
create or replace function public.training_upgrade_offer(p_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
           'product_id',    pr.id,
           'slug',          pr.slug,
           'title',         pr.title,
           'description',   pr.description,
           'level',         tp.level::text,
           'price_minor',   public.product_price_minor(pr.id),
           'lessons',       (select count(*)::int from public.lessons l
                               join public.course_sections s on s.id = l.section_id
                              where s.product_id = pr.id),
           'depth',         tp.commission_depth,
           'validity_days', tp.validity_days,
           'certificate',   tp.certificate_enabled
         )
    from public.training_programs tp
    join public.products pr on pr.id = tp.product_id
   where pr.status = 'published'
     and public.training_level_rank(tp.level::text) > public.owned_training_rank(p_user_id)
   order by public.training_level_rank(tp.level::text)
   limit 1;
$$;

revoke execute on function public.training_upgrade_offer(uuid) from public, anon, authenticated;
grant execute on function public.training_upgrade_offer(uuid) to service_role;
