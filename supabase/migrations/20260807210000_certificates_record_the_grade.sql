-- ============================================================================
-- Migration 145 — a certificate records the grade it was earned with
--
-- Migration 144 added the column and the calculation. This is the one line that
-- makes it happen: `issue_certificate_if_earned` now writes the grade at the
-- moment it issues.
--
-- WRITTEN AT ISSUE, NOT DERIVED ON READ. A grade is a statement about how
-- somebody did on the day they finished. Computing it live would let it move
-- when a quiz is edited, a question is deleted, or the learner retakes a
-- checkpoint months later — and a certificate whose score changes afterwards is
-- not a certificate, it is a dashboard.
--
-- Everything else about this function is unchanged, including the rule it
-- exists to enforce: a certificate is for the WHOLE course, not the activation
-- threshold. Restated in full rather than patched, because a `create or
-- replace` that only shows the diff is unreadable in six months.
-- ============================================================================

create or replace function public.issue_certificate_if_earned(p_user_id uuid, p_product_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_enabled bool;
  v_percent int;
  v_grade   int;
  v_id      uuid;
begin
  select tp.certificate_enabled into v_enabled
    from public.training_programs tp where tp.product_id = p_product_id;

  if not coalesce(v_enabled, false) then
    return null;
  end if;

  /* The WHOLE course. The activation threshold says when somebody may start
     promoting (B9); a certificate says they finished. Issuing at the threshold
     would certify half a course. */
  v_percent := public.training_completion_percent(p_user_id, p_product_id);
  if v_percent < 100 then
    return null;
  end if;

  -- Frozen here, deliberately. See the header.
  v_grade := public.certificate_grade_for(p_user_id, p_product_id);

  insert into public.certificates (user_id, product_id, verification_code, grade_percent)
  values (p_user_id, p_product_id, public.generate_certificate_code(), v_grade)
  on conflict (user_id, product_id) do nothing
  returning id into v_id;

  if v_id is not null then
    insert into public.notifications (user_id, type, title, body, reference)
    select p_user_id, 'announcement',
           'Certificate earned',
           'You have completed ' || p.title || '. Your certificate is ready.',
           jsonb_build_object(
             'kind', 'certificate',
             'certificate_id', v_id::text,
             'product_id', p_product_id::text
           )
      from public.products p where p.id = p_product_id;
  end if;

  return v_id;
end;
$$;

revoke execute on function public.issue_certificate_if_earned(uuid, uuid) from public, anon, authenticated;
grant  execute on function public.issue_certificate_if_earned(uuid, uuid) to service_role;
