-- ---------------------------------------------------------------------------
-- Reading a certificate, by the person who earned it and by anybody checking.
--
-- A verification code that nothing can be checked against is decoration, and a
-- certificate people are told to share is a certificate that will be shown to
-- somebody who wants to know it is real. One function serves both: the owner's
-- download page and the public check.
--
-- ⚠️ WHAT IT DELIBERATELY DOES NOT RETURN: the holder's email, their user id,
-- their phone, or anything else on the profile. A verification page answers one
-- question — is this document genuine and what does it say — and every extra
-- field is a lookup service for anybody who collects certificate codes.
-- ---------------------------------------------------------------------------

create or replace function public.certificate_by_code(p_code text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
           'code',        c.verification_code,
           'legal_name',  c.legal_name,
           /* The display name is the fallback so a certificate is never blank,
              but the page asks for a legal name before it will let one be
              downloaded. */
           'holder',      coalesce(c.legal_name, pr.full_name),
           'course',      p.title,
           'level',       tp.level::text,
           'grade',       c.grade_percent,
           'issued_at',   c.issued_at
         )
    from public.certificates c
    join public.products p on p.id = c.product_id
    left join public.training_programs tp on tp.product_id = c.product_id
    left join public.profiles pr on pr.id = c.user_id
   where upper(c.verification_code) = upper(btrim(p_code));
$$;

/* ⚠️ THIS ONE IS READABLE BY ANYONE, ON PURPOSE — it is the public check, and
   the code is the credential. `anon` gets it; nothing else here does. */
revoke execute on function public.certificate_by_code(text) from public;
grant execute on function public.certificate_by_code(text) to anon, authenticated, service_role;

/** The owner's view: the same document, found by product rather than by code. */
create or replace function public.my_certificate(p_user_id uuid, p_product_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
           'code',        c.verification_code,
           'legal_name',  c.legal_name,
           'holder',      coalesce(c.legal_name, pr.full_name),
           'course',      p.title,
           'level',       tp.level::text,
           'grade',       c.grade_percent,
           'issued_at',   c.issued_at
         )
    from public.certificates c
    join public.products p on p.id = c.product_id
    left join public.training_programs tp on tp.product_id = c.product_id
    left join public.profiles pr on pr.id = c.user_id
   where c.user_id = p_user_id
     and c.product_id = p_product_id;
$$;

revoke execute on function public.my_certificate(uuid, uuid) from public, anon, authenticated;
grant execute on function public.my_certificate(uuid, uuid) to service_role;
