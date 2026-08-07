-- ---------------------------------------------------------------------------
-- Certificates get a pass mark and a name, and announcements get an audience.
--
-- Operator, 2026-08-07:
--   "after earning the certificate the notification went to the ads rather
--    than the affiliate"
--   "i want one [announcement] for the affiliates so i can send business type
--    based announcements"
--   "before that they need to enter their legal name"
--   "you need to attain 70 percent before you can get a certificate"
--   "in the certificate include every user's grade score for the course"
-- ---------------------------------------------------------------------------

-- ── 1. The certificate notification was going to the wrong bell ────────────
--
-- ⚠️ AND HERE IS WHY THE LAST MIGRATION DID NOT CATCH IT: this function does
-- NOT call `create_notification`. It writes to `public.notifications` directly,
-- so it never saw the new `business` argument and quietly took the column
-- default, which is 'ads'. Finishing an affiliate course announced itself in
-- the other business.
--
-- Every direct insert into that table is a notification that cannot be routed.
-- There were two: this one and `broadcast_notification`, fixed below.

-- ── 2. A pass mark ─────────────────────────────────────────────────────────
--
-- Completion and GRADE are different things and the certificate now needs
-- both: every lesson finished, and an average quiz score at or above the mark.
-- Config rather than a constant, because it is a number the operator will want
-- to move once they see real scores.
insert into public.app_config (key, value, value_type, min_value, max_value, is_public, description)
values ('certificate_pass_percent', '70', 'int', 0, 100, false,
        'Average quiz score needed for a certificate. Finishing every lesson is not enough on its own; the score has to reach this. Raising it does not withdraw a certificate already issued.')
on conflict (key) do nothing;

-- ── 3. The legal name ──────────────────────────────────────────────────────
--
-- On the PROFILE because a person has one legal name, and frozen onto the
-- CERTIFICATE because a certificate is a record of what was true when it was
-- issued. Somebody who later corrects a typo in their profile should not
-- silently rewrite a document already downloaded and shared.
alter table public.profiles
  add column if not exists legal_name text;

alter table public.certificates
  add column if not exists legal_name text;

create or replace function public.set_certificate_name(
  p_user_id    uuid,
  p_product_id uuid,
  p_legal_name text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_name text := btrim(coalesce(p_legal_name, ''));
begin
  /* Two words minimum. A certificate reading "Kwame" is not a document
     anybody can present, and the whole point of asking is that the display
     name on the account is often a nickname. */
  if char_length(v_name) < 3 or position(' ' in v_name) = 0 then
    return jsonb_build_object('outcome', 'too_short');
  end if;
  if char_length(v_name) > 80 then
    return jsonb_build_object('outcome', 'too_long');
  end if;

  update public.profiles set legal_name = v_name where id = p_user_id;

  update public.certificates
     set legal_name = v_name
   where user_id = p_user_id
     and product_id = p_product_id;

  if not found then
    return jsonb_build_object('outcome', 'no_certificate');
  end if;

  return jsonb_build_object('outcome', 'ok', 'legal_name', v_name);
end;
$$;

revoke execute on function public.set_certificate_name(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.set_certificate_name(uuid, uuid, text) to service_role;

-- ── 4. Issue only on a pass, and tell the right bell ───────────────────────

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
     promoting; a certificate says they finished. Issuing at the threshold
     would certify half a course. */
  v_percent := public.training_completion_percent(p_user_id, p_product_id);
  if v_percent < 100 then
    return null;
  end if;

  -- Frozen here, deliberately: a certificate records a grade, not a live one.
  v_grade := public.certificate_grade_for(p_user_id, p_product_id);
  v_pass  := coalesce(public.config_int('certificate_pass_percent'), 70);

  /* ⚠️ A NULL GRADE IS NOT A PASS. `certificate_grade_for` returns null when a
     course has no quizzes at all, and `null < 70` is null, which is not true —
     so a bare comparison would have issued a certificate to everybody on an
     unquizzed course. Stated explicitly. */
  if v_grade is null or v_grade < v_pass then
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
      /* THE FIX. Affiliate training, affiliate bell. */
      'affiliate'
    );
  end if;

  return v_id;
end;
$$;

revoke execute on function public.issue_certificate_if_earned(uuid, uuid) from public, anon, authenticated;
grant execute on function public.issue_certificate_if_earned(uuid, uuid) to service_role;

-- ── 5. Announcements can address one business ──────────────────────────────
--
-- `audience` already existed on the table and was always written as 'all'.
-- It now means something, and the notification each recipient receives is
-- tagged so it lands in the bell the announcement was addressed to.

alter table public.announcements
  add column if not exists business public.notification_business not null default 'both';

/* ⚠️ THE OLD SIGNATURES ARE DROPPED, NOT LEFT BESIDE THE NEW ONES. Adding
   parameters with defaults creates an OVERLOAD, and then a call with the old
   argument count matches both candidates and Postgres refuses it as
   ambiguous — so leaving them would break every existing caller rather than
   extend it. The previous migration made exactly this point about
   `create_notification`; these two are the same shape and I still had to be
   shown it by `count(*)` coming back as 2. */
drop function if exists public.broadcast_notification(public.notification_type, text, text, jsonb);
drop function if exists public.admin_broadcast_announcement(uuid, text, text);

/* The second direct insert into `notifications`. Same failure as the
   certificate: no `business`, so every broadcast defaulted to 'ads' and an
   affiliate announcement would have gone to the wrong bell. */
create or replace function public.broadcast_notification(
  p_type      public.notification_type,
  p_title     text,
  p_body      text,
  p_reference jsonb default null,
  p_business  public.notification_business default 'both',
  p_audience  text default 'all'
)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare v_count integer;
begin
  insert into public.notifications (user_id, type, title, body, reference, business)
  select pr.id, p_type, p_title, p_body, p_reference, p_business
    from public.profiles pr
   where pr.disabled_at is null
     /* An affiliate announcement reaches AFFILIATES, not everybody. Sending
        "your commission rates have changed" to somebody who has never opened
        the marketplace is the kind of message that gets an app muted. */
     and (
       p_audience <> 'affiliates'
       or exists (select 1 from public.affiliate_accounts a where a.user_id = pr.id)
     );
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke execute on function public.broadcast_notification(public.notification_type, text, text, jsonb, public.notification_business, text) from public, anon, authenticated;
grant execute on function public.broadcast_notification(public.notification_type, text, text, jsonb, public.notification_business, text) to service_role;

create or replace function public.admin_broadcast_announcement(
  p_admin    uuid,
  p_title    text,
  p_body     text,
  p_audience text default 'all'
)
returns public.announcements
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_title    text := btrim(coalesce(p_title, ''));
  v_body     text := btrim(coalesce(p_body, ''));
  v_audience text := coalesce(nullif(btrim(p_audience), ''), 'all');
  v_business public.notification_business;
  v_count    int;
  v_row      public.announcements;
begin
  perform public.assert_admin(p_admin);

  if char_length(v_title) = 0 then
    raise exception 'An announcement needs a title' using errcode = 'check_violation';
  end if;
  if char_length(v_body) = 0 then
    raise exception 'An announcement needs a message' using errcode = 'check_violation';
  end if;
  if char_length(v_title) > 120 then
    raise exception 'That title is too long. Please keep it to 120 characters or fewer.'
      using errcode = 'check_violation';
  end if;
  if char_length(v_body) > 1000 then
    raise exception 'That message is too long. Please keep it to 1000 characters or fewer.'
      using errcode = 'check_violation';
  end if;
  if v_audience not in ('all', 'affiliates', 'ads') then
    raise exception 'Unknown audience' using errcode = 'check_violation';
  end if;

  /* Who receives it and WHICH BELL it lands in are two different questions.
     An "everyone" announcement is account-wide news and shows in both bells;
     one addressed to a business shows only in that business's bell. */
  v_business := case v_audience
                  when 'affiliates' then 'affiliate'::public.notification_business
                  when 'ads'        then 'ads'::public.notification_business
                  else 'both'::public.notification_business
                end;

  v_count := public.broadcast_notification(
    'announcement', v_title, v_body, null, v_business, v_audience
  );

  insert into public.announcements (sent_by, title, body, audience, recipient_count, business)
  values (p_admin, v_title, v_body, v_audience, v_count, v_business)
  returning * into v_row;

  return v_row;
end;
$$;

revoke execute on function public.admin_broadcast_announcement(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.admin_broadcast_announcement(uuid, text, text, text) to service_role;
