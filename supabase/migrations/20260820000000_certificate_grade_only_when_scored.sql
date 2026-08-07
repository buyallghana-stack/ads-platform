-- ---------------------------------------------------------------------------
-- The 70% applies where there IS a score, not where there is none.
--
-- The pass mark shipped as `if v_grade is null or v_grade < v_pass then return
-- null`, with a note arguing that a null grade must not be treated as a pass.
-- The reasoning was sound and the conclusion was wrong, and three tests said so
-- within the hour: a course with no quizzes has no grade to fail, so that rule
-- issued no certificate at all, silently, for ever.
--
-- ⚠️ `certificate_enabled` IS THE OPERATOR'S INTENT. If they switch
-- certificates on for a course, refusing to issue one because they have not
-- written a quiz yet is a trap they would have to debug from the outside — the
-- lesson finishes, the notification never comes, and nothing anywhere says
-- why. Both real training programmes have quizzes (3 and 4), so this changes
-- nothing about them; it changes what happens to a course that does not.
--
-- The rule is therefore: finish every lesson, AND if the course scores you,
-- score at least `certificate_pass_percent`. A certificate with no grade
-- prints no grade line — `CertificateSheet` already guards on null rather than
-- rendering 0%, which would be a different and much worse claim.
-- ---------------------------------------------------------------------------

create or replace function public.issue_certificate_if_earned(
  p_user_id    uuid,
  p_product_id uuid
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_enabled bool;
  v_percent int;
  v_grade   int;
  v_pass    int;
  v_id      uuid;
  v_name    text;
begin
  select tp.certificate_enabled into v_enabled
    from public.training_programs tp where tp.product_id = p_product_id;

  if not coalesce(v_enabled, false) then
    return null;
  end if;

  /* The WHOLE course. The activation threshold says when somebody may start
     promoting; a certificate says they finished. */
  v_percent := public.training_completion_percent(p_user_id, p_product_id);
  if v_percent < 100 then
    return null;
  end if;

  -- Frozen here, deliberately: a certificate records a grade, not a live one.
  v_grade := public.certificate_grade_for(p_user_id, p_product_id);
  v_pass  := coalesce(public.config_int('certificate_pass_percent'), 70);

  /* Null means the course has no quizzes, so there is no score to fall short
     of. Only an actual score can fail. */
  if v_grade is not null and v_grade < v_pass then
    return null;
  end if;

  select legal_name into v_name from public.profiles where id = p_user_id;

  insert into public.certificates
    (user_id, product_id, verification_code, grade_percent, legal_name)
  values
    (p_user_id, p_product_id, public.generate_certificate_code(), v_grade, v_name)
  on conflict (user_id, product_id) do nothing
  returning id into v_id;

  if v_id is not null then
    perform public.create_notification(
      p_user_id,
      'announcement',
      'Certificate earned',
      (select 'You have completed ' || p.title ||
              '. Enter your legal name to download it.'
         from public.products p where p.id = p_product_id),
      jsonb_build_object(
        'kind', 'certificate',
        'certificate_id', v_id::text,
        'product_id', p_product_id::text
      ),
      'affiliate'
    );
  end if;

  return v_id;
end;
$$;

revoke execute on function public.issue_certificate_if_earned(uuid, uuid) from public, anon, authenticated;
grant execute on function public.issue_certificate_if_earned(uuid, uuid) to service_role;
