-- ============================================================================
-- Migration 219 — announcements, and creating a plan, work again
--
-- 20260865000000 dropped public.affiliate_accounts. `broadcast_notification`
-- was still filtering on it:
--
--     and (
--       p_audience <> 'affiliates'
--       or exists (select 1 from public.affiliate_accounts a where a.user_id = pr.id)
--     )
--
-- A plpgsql statement is PLANNED before it is executed, and planning fails
-- outright when a relation named in it does not exist. So the audience VALUE
-- never mattered and no short circuit could save it: every single call raised
--
--     relation "public.affiliate_accounts" does not exist
--
-- which took out both callers, and both of them are live admin features:
--
--   admin_broadcast_announcement  ->  sending any announcement, to anyone
--   notify_new_tier               ->  the trigger on public.tiers, so adding
--                                     or activating a PLAN in the admin
--
-- That is the shape to remember: dropping a table does not touch the function
-- bodies that read it, because Postgres does not resolve a name in plpgsql
-- until the statement runs. 87 functions in this database still name a table
-- that 20260865000000 removed. These two are merely the ones that fire on a
-- path somebody uses. The rest are waiting.
--
-- The filter itself is not rewritten, it goes. It existed to keep "your
-- commission rates have changed" away from people who had never opened the
-- marketplace. There is no marketplace and there are no affiliates, so there
-- is nobody left to keep it from, and an audience argument that selects
-- recipients no longer has anything to select on.
--
-- `p_audience` therefore leaves the signature rather than staying on as a
-- parameter that reads as if it still filters something. What the admin calls
-- the audience has not gone away: it still decides WHICH BELL the message
-- lands in, and that was always a different argument (`p_business`).
-- ============================================================================

/* The old six-argument form has to be dropped, not replaced: `create or
   replace` cannot remove a parameter, and leaving it behind would give
   PostgREST two overloads to choose between. Precedent: 20260819000000, which
   dropped the four-argument form for the same reason. */
drop function if exists public.broadcast_notification(
  public.notification_type, text, text, jsonb, public.notification_business, text);

create or replace function public.broadcast_notification(
  p_type      public.notification_type,
  p_title     text,
  p_body      text,
  p_reference jsonb DEFAULT null,
  p_business  public.notification_business DEFAULT 'both'
)
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare v_count integer;
begin
  insert into public.notifications (user_id, type, title, body, reference, business)
  select pr.id, p_type, p_title, p_body, p_reference, p_business
    from public.profiles pr
   where pr.disabled_at is null;
  get diagnostics v_count = row_count;
  return v_count;
end;
$function$;

/* ⚠️ `create function` grants EXECUTE to PUBLIC by default, and a drop plus
   create reopens what the original migration had closed. Re-revoke every
   time, including from anon and authenticated: this writes a row per profile
   and nothing holding a browser key may call it. */
revoke execute on function public.broadcast_notification(
  public.notification_type, text, text, jsonb, public.notification_business)
  from public, anon, authenticated;
grant execute on function public.broadcast_notification(
  public.notification_type, text, text, jsonb, public.notification_business)
  to service_role;

-- ----------------------------------------------------------------------------
-- The admin entry point: 'affiliates' is refused rather than quietly widened.
--
-- The composer only ever sends 'all' or 'ads' now, so this is defence, not a
-- feature change. It matters because the alternative is worse than an error:
-- with the filter gone, an announcement addressed to affiliates would reach
-- EVERY user on the platform, which is precisely the outcome the filter was
-- written to prevent. Fail closed, loudly.
-- ----------------------------------------------------------------------------
create or replace function public.admin_broadcast_announcement(
  p_admin    uuid,
  p_title    text,
  p_body     text,
  p_audience text DEFAULT 'all'
)
returns public.announcements
language plpgsql
security definer
set search_path = ''
as $function$
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
  if v_audience not in ('all', 'ads') then
    raise exception 'Unknown audience' using errcode = 'check_violation';
  end if;

  /* Who receives it and WHICH BELL it lands in are two different questions.
     An "everyone" announcement is account-wide news and shows in both bells;
     one addressed to a business shows only in that business's bell. */
  v_business := case v_audience
                  when 'ads' then 'ads'::public.notification_business
                  else 'both'::public.notification_business
                end;

  v_count := public.broadcast_notification(
    'announcement', v_title, v_body, null, v_business
  );

  insert into public.announcements (sent_by, title, body, audience, recipient_count, business)
  values (p_admin, v_title, v_body, v_audience, v_count, v_business)
  returning * into v_row;

  return v_row;
end;
$function$;

revoke execute on function public.admin_broadcast_announcement(uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.admin_broadcast_announcement(uuid, text, text, text)
  to service_role;
