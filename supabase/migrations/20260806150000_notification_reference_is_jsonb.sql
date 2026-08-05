-- ============================================================================
-- Migration 126 — notification references are structured, not strings
--
-- Migration 125 wrote `reference` as a colon-joined string —
-- 'affiliate_entitlement:<id>:30'. The column is JSONB, and Phase 1 puts a
-- structured object in it: {"task_id": "...", "points": 300}.
--
-- So the inserts failed outright, which is the good version of being wrong.
-- The bad version would have been a text column silently accepting a
-- convention nothing else in the product follows, leaving whoever writes the
-- notifications screen to parse strings by hand.
--
-- The de-duplication idea is unchanged and still worth keeping: the
-- notification's OWN reference is the record of what has been sent, so a
-- second run cannot repeat itself and a job that failed halfway can simply be
-- run again. A `warned_30_at` column would be a second source of truth that
-- drifts the first time a send succeeds and the update does not. Only the
-- shape of that record changes here, from a string to `@>` containment.
-- ============================================================================

/* Containment is the query both functions use to ask "have I already sent
   this?", and it is the one that would get slow first. */
create index if not exists notifications_reference_idx
  on public.notifications using gin (reference);


create or replace function public.issue_certificate_if_earned(
  p_user_id uuid,
  p_product_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_enabled bool;
  v_percent int;
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

  insert into public.certificates (user_id, product_id, verification_code)
  values (p_user_id, p_product_id, public.generate_certificate_code())
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
grant execute on function public.issue_certificate_if_earned(uuid, uuid) to service_role;


create or replace function public.warn_expiring_entitlements()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_days  int;
  v_sent  int := 0;
  v_batch int;
begin
  foreach v_days in array array[30, 7, 1] loop
    insert into public.notifications (user_id, type, title, body, reference)
    select a.user_id,
           'announcement',
           case when v_days = 1 then 'Your affiliate access ends tomorrow'
                else 'Your affiliate access ends in ' || v_days || ' days' end,
           'Renew ' || p.title || ' to keep promoting and earning commission.',
           jsonb_build_object(
             'kind', 'entitlement_expiry',
             'entitlement_id', e.id::text,
             'days', v_days
           )
      from public.affiliate_entitlements e
      join public.affiliate_accounts a on a.id = e.affiliate_id
      join public.training_programs tp on tp.id = e.training_program_id
      join public.products p on p.id = tp.product_id
     where e.status = 'active'
       and e.expires_at > now()
       and e.expires_at <= now() + make_interval(days => v_days)
       and not exists (
         select 1 from public.notifications n
          where n.reference @> jsonb_build_object(
                  'kind', 'entitlement_expiry',
                  'entitlement_id', e.id::text,
                  'days', v_days
                )
       );

    get diagnostics v_batch = row_count;
    v_sent := v_sent + v_batch;
  end loop;

  return v_sent;
end;
$$;

revoke execute on function public.warn_expiring_entitlements() from public, anon, authenticated;
grant execute on function public.warn_expiring_entitlements() to service_role;
