-- ============================================================================
-- Migration 086 — three staff roles, and who may do what with them
--
-- Operator, 2026-07-31: "the roles involve are super admin which i currently
-- have, support for messages, ads manager for adding ads. super admin can
-- revoke, add admins at anytime."
--
-- ---------------------------------------------------------------------------
-- THE ONE THING THAT CHANGES EVERYWHERE: WHERE THE ANSWER COMES FROM
-- ---------------------------------------------------------------------------
-- `is_admin()` has always read the `user_role` JWT CLAIM, stamped into the
-- token by `custom_access_token_hook` when the token is issued. That is fast
-- and it was fine while there was exactly one administrator who was never
-- going to be demoted. It stops being fine the moment a super admin can REVOKE
-- somebody: a token already in a browser keeps its old claim until it is
-- refreshed, so a revoked admin would keep their access for up to an hour, and
-- every RLS policy on the thirteen tables guarded by `is_admin()` would go on
-- believing them.
--
-- So `is_admin()` now reads `public.user_roles`. It is STABLE, so Postgres
-- evaluates it once per statement rather than once per row, and it is SECURITY
-- DEFINER so it does not depend on the caller being able to read that table.
-- Revocation is immediate everywhere, which is the only behaviour worth having
-- for a permission somebody has just been asked to give up.
--
-- ---------------------------------------------------------------------------
-- FAIL CLOSED: WHAT THE NEW ROLES CANNOT DO
-- ---------------------------------------------------------------------------
-- Thirty-four functions call `assert_admin(p_admin_id)`. That function now
-- means SUPER ADMIN — so every one of them, including every path that moves
-- money, is closed to support and ads managers by default and stays closed
-- without anybody having to remember to close it. The ten functions those two
-- roles genuinely need are opened one at a time, by name, through
-- `assert_admin_area`. A role gains a power because somebody wrote its name
-- next to that power, never because a check was forgotten.
--
-- `is_admin()` is the READ side and is deliberately wider: any staff role
-- passes it, which is what lets support open the messages screen and an ads
-- manager open the ads screen at all. It also means both can READ the tables
-- the admin policies cover. That is a real widening and it is the intended
-- trade: they are staff, they cannot write anything outside their area, and
-- the alternative is thirteen RLS policies with a role list baked into each.
--
-- 'admin' IS KEPT AS A SYNONYM FOR 'super_admin', permanently. The existing
-- administrator's row is migrated, but their browser is holding a token that
-- says `admin` until it refreshes, and locking the only super admin out of
-- their own console while they hold a valid session would be a poor way to
-- ship a permissions change.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. The role a user actually holds
-- ---------------------------------------------------------------------------
--
-- One row wins, by precedence, because `user_roles` does not stop somebody
-- holding two. The order is the order of power.

create or replace function public.admin_role(p_user_id uuid)
returns public.app_role
language sql
stable
security definer
set search_path = ''
as $$
  select ur.role
    from public.user_roles ur
   where ur.user_id = p_user_id
   order by case ur.role
              when 'super_admin' then 1
              when 'admin'       then 2
              when 'support'     then 3
              when 'ads_manager' then 4
              else 9
            end
   limit 1;
$$;

comment on function public.admin_role(uuid) is
  'The single role a user is treated as holding, highest first. `admin` is the pre-2026-07-31 name for `super_admin` and ranks with it.';

revoke execute on function public.admin_role(uuid) from public, anon;


create or replace function public.is_super_admin(p_user_id uuid default null)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.admin_role(coalesce(p_user_id, (select auth.uid()))) in ('super_admin', 'admin');
$$;

revoke execute on function public.is_super_admin(uuid) from public, anon;


-- ---------------------------------------------------------------------------
-- 2. is_admin — now "any staff role", and now read from the table
-- ---------------------------------------------------------------------------
--
-- Restated rather than replaced in meaning: every policy and every list
-- function that already calls it keeps working, and gains the three new roles.
-- See the header for why the claim is no longer trusted.

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.admin_role((select auth.uid()))
           in ('super_admin', 'admin', 'support', 'ads_manager');
$$;

comment on function public.is_admin() is
  'True for any staff role. Reads user_roles, NOT the JWT claim, so a revoked administrator loses access immediately rather than when their token next refreshes.';


-- ---------------------------------------------------------------------------
-- 3. What each role may do
-- ---------------------------------------------------------------------------
--
-- Two areas are delegated. Everything else is super admin, by omission.

create or replace function public.admin_area_allowed(p_user_id uuid, p_area text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case public.admin_role(p_user_id)
    when 'super_admin' then true
    when 'admin'       then true
    when 'support'     then p_area = 'support'
    when 'ads_manager' then p_area = 'ads'
    else false
  end;
$$;

comment on function public.admin_area_allowed(uuid, text) is
  'Whether a staff member may act in an area. Areas are `support` (the message queue) and `ads` (ads and advertisers, but never their payments, which are money).';

revoke execute on function public.admin_area_allowed(uuid, text) from public, anon;


-- ---------------------------------------------------------------------------
-- 4. The assertions the write paths call
-- ---------------------------------------------------------------------------
--
-- `assert_admin` keeps its name and its signature — thirty-four functions call
-- it — and narrows its meaning to super admin. Both assertions stamp
-- `app.actor_id`, which is what puts the acting administrator in the audit
-- trail; forgetting that line would make every audit row anonymous.

create or replace function public.assert_admin(p_admin_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_super_admin(p_admin_id) then
    raise exception 'Not an administrator' using errcode = 'insufficient_privilege';
  end if;

  perform set_config('app.actor_id', p_admin_id::text, true);
end;
$$;

comment on function public.assert_admin(uuid) is
  'Refuses anybody but a super admin. Every admin function that does not name an area is therefore super-admin-only by default, which is the direction a permission check should fail in.';


create or replace function public.assert_admin_area(p_admin_id uuid, p_area text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.admin_area_allowed(p_admin_id, p_area) then
    raise exception 'Not allowed for this role' using errcode = 'insufficient_privilege';
  end if;

  perform set_config('app.actor_id', p_admin_id::text, true);
end;
$$;

revoke execute on function public.assert_admin_area(uuid, text) from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 5. The token hook learns the new roles
-- ---------------------------------------------------------------------------
--
-- ⚠️ THIS FUNCTION MUST NOT CALL ANYTHING `supabase_auth_admin` CANNOT EXECUTE,
-- and the ordering below is therefore written out in full rather than
-- delegating to `admin_role`. Learned the hard way, in production, minutes
-- after the first version of this migration was applied: the hook runs AS that
-- role while a token is being issued, `admin_role` is revoked from everybody
-- but the owner, and a hook that throws does not fall back to a default claim
-- — it fails the token issuance. Every sign-in on the platform returned "that
-- email or password is not correct" until the grant below was added, with the
-- password perfectly correct and no error in the application logs, because the
-- failure was inside GoTrue.
--
-- The claim is no longer what authorises anything (see the header). It is
-- still stamped because it is useful in logs, and because leaving it saying
-- `user` for a support agent is a confusing thing to debug against later.

create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  claims   jsonb;
  resolved public.app_role;
begin
  select ur.role
    into resolved
    from public.user_roles ur
   where ur.user_id = (event ->> 'user_id')::uuid
   order by case ur.role
              when 'super_admin' then 1
              when 'admin'       then 2
              when 'support'     then 3
              when 'ads_manager' then 4
              else 9
            end
   limit 1;

  claims := event -> 'claims';
  claims := jsonb_set(claims, '{user_role}', to_jsonb(coalesce(resolved, 'user')::text));

  return jsonb_set(event, '{claims}', claims);
end;
$$;

grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;


-- ---------------------------------------------------------------------------
-- 6. Granting and revoking
-- ---------------------------------------------------------------------------

create or replace function public.admin_grant_role(
  p_admin_id  uuid,
  p_target_id uuid,
  p_role      text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role public.app_role;
begin
  perform public.assert_admin(p_admin_id);

  if p_role not in ('super_admin', 'support', 'ads_manager') then
    raise exception 'Unknown role: %', p_role using errcode = 'check_violation';
  end if;
  v_role := p_role::public.app_role;

  if not exists (select 1 from public.profiles where id = p_target_id) then
    raise exception 'That account does not exist' using errcode = 'check_violation';
  end if;

  -- One role per person. Holding two would make `admin_role` a precedence
  -- puzzle at exactly the moment somebody is trying to reduce access.
  delete from public.user_roles where user_id = p_target_id;
  insert into public.user_roles (user_id, role) values (p_target_id, v_role);

end;
$$;

revoke execute on function public.admin_grant_role(uuid, uuid, text)
  from public, anon, authenticated;


create or replace function public.admin_revoke_role(p_admin_id uuid, p_target_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_was     public.app_role;
  v_supers  int;
begin
  perform public.assert_admin(p_admin_id);

  v_was := public.admin_role(p_target_id);
  if v_was is null or v_was = 'user' then
    raise exception 'That account is not an administrator' using errcode = 'check_violation';
  end if;

  -- TWO REFUSALS, and both are about not being able to undo the mistake.
  -- Revoking yourself, or the last super admin, leaves a console nobody can
  -- open — recoverable only by hand-editing the database.
  if p_target_id = p_admin_id then
    raise exception 'You cannot revoke your own access' using errcode = 'check_violation';
  end if;

  if v_was in ('super_admin', 'admin') then
    select count(*) into v_supers from public.user_roles
     where role in ('super_admin', 'admin');
    if v_supers <= 1 then
      raise exception 'There must always be one super admin' using errcode = 'check_violation';
    end if;
  end if;

  update public.user_roles set role = 'user' where user_id = p_target_id;

end;
$$;

revoke execute on function public.admin_revoke_role(uuid, uuid)
  from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 7. The list the screen shows
-- ---------------------------------------------------------------------------
--
-- Drop and recreate: the return type gains the role and the invitation state.
-- `two_factor` is the column this list has always existed to show — an
-- administrator without an authenticator is the weakest point in the payout
-- queue — and it matters more now that there can be several of them.

drop function if exists public.admin_list_administrators();

create or replace function public.admin_list_administrators()
returns table (
  id           uuid,
  name         text,
  email        text,
  role         text,
  two_factor   boolean,
  granted_at   timestamptz,
  last_seen_at timestamptz,
  accepted     boolean,
  is_you       boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is not null and not public.is_admin() then
    raise exception 'Not an administrator' using errcode = 'insufficient_privilege';
  end if;

  return query
  select
    p.id,
    p.full_name,
    u.email::text,
    r.role::text,
    -- Enrolled means CONFIRMED. A half-finished enrolment leaves a cipher
    -- behind with no confirmation, and counting that as protected is exactly
    -- the wrong way to be wrong on this screen.
    exists (select 1 from public.user_security s
             where s.user_id = p.id
               and s.totp_secret_cipher is not null
               and s.totp_confirmed_at is not null),
    r.granted_at,
    (select max(sr.signed_in_at) from public.user_session_records sr where sr.user_id = p.id),
    -- An invitation nobody has accepted is an account that has never been
    -- signed into. Listing it as an ordinary administrator would overstate
    -- who actually holds the keys.
    exists (select 1 from public.user_session_records sr where sr.user_id = p.id),
    p.id = (select auth.uid())
  from public.user_roles r
  join public.profiles p on p.id = r.user_id
  join auth.users u on u.id = p.id
  where r.role in ('super_admin', 'admin', 'support', 'ads_manager')
    and p.deleted_at is null
  order by case r.role
             when 'super_admin' then 1 when 'admin' then 2
             when 'support' then 3 else 4 end,
           r.granted_at;
end;
$$;

revoke execute on function public.admin_list_administrators() from public, anon;


-- ---------------------------------------------------------------------------
-- 7b. A permission change is exactly the kind of thing an audit exists for
-- ---------------------------------------------------------------------------
--
-- `user_roles` carried no audit trigger, so until now granting somebody the
-- keys left no trace at all. The two functions above stamp `app.actor_id`
-- through the assertion, which is what lets the existing trigger record WHO
-- made the change rather than just that it happened.

drop trigger if exists user_roles_audit on public.user_roles;
create trigger user_roles_audit
  after insert or update or delete on public.user_roles
  for each row execute function public.audit_row_change();


-- ---------------------------------------------------------------------------
-- 8. The administrator that already exists becomes a super admin
-- ---------------------------------------------------------------------------

update public.user_roles set role = 'super_admin' where role = 'admin';
-- ---------------------------------------------------------------------------
-- 9. The ten functions the delegated roles are actually given
-- ---------------------------------------------------------------------------
--
-- GENERATED FROM THE LIVE DEFINITIONS, not retyped. Each body below is exactly
-- what `pg_get_functiondef` returned, with one line changed: the
-- `assert_admin` call became `assert_admin_area(..., 'support'|'ads')`. That
-- rule exists because migration 081 was written by retyping a function from a
-- partial read and silently dropped three guards; a mechanical rewrite of the
-- real text cannot do that.
--
-- Support gets the message queue. The ads manager gets ads and advertisers —
-- but NOT `admin_record_advertiser_payment` or `admin_delete_advertiser_payment`,
-- which are money and stay with the super admin.

-- admin_get_support_thread — delegated to the support role
CREATE OR REPLACE FUNCTION public.admin_get_support_thread(p_admin uuid, p_user uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_thread public.support_threads;
  v_out    jsonb;
begin
  perform public.assert_admin_area(p_admin, 'support');

  select * into v_thread from public.support_threads where user_id = p_user;

  select jsonb_build_object(
    'user_id',         p_user,
    'status',          coalesce(v_thread.status::text, 'open'),
    'opened_at',       v_thread.opened_at,
    'last_message_at', v_thread.last_message_at,
    'messages', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id',         m.id,
               'author',     m.author,
               'author_name', case when m.author = 'admin'
                                   then coalesce(a.full_name, 'Support')
                                   else null end,
               'body',       m.body,
               'context',    m.context,
               'created_at', m.created_at,
               'read_at',    m.read_at
             ) order by m.created_at)
        from public.support_messages m
        left join public.profiles a on a.id = m.author_id
       where m.user_id = p_user
    ), '[]'::jsonb)
  ) into v_out;

  return v_out;
end;
$function$
;

revoke execute on function public.admin_get_support_thread(p_admin uuid, p_user uuid)
  from public, anon, authenticated;

-- admin_send_support_message — delegated to the support role
CREATE OR REPLACE FUNCTION public.admin_send_support_message(p_admin uuid, p_user uuid, p_body text)
 RETURNS support_messages
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_body text := btrim(coalesce(p_body, ''));
  v_row  public.support_messages;
begin
  perform public.assert_admin_area(p_admin, 'support');

  if char_length(v_body) = 0 then
    raise exception 'Write a reply first' using errcode = 'check_violation';
  end if;
  if char_length(v_body) > 2000 then
    raise exception 'That reply is too long. Please shorten it to 2000 characters or fewer.'
      using errcode = 'check_violation';
  end if;

  if not exists (select 1 from public.profiles where id = p_user) then
    raise exception 'That account no longer exists' using errcode = 'check_violation';
  end if;

  -- An admin may open a conversation with somebody who has never written —
  -- "your payout is held because…" is better sent than waited for.
  insert into public.support_threads (user_id, last_message_at)
  values (p_user, now())
  on conflict (user_id) do update
    set last_message_at = now(),
        status          = 'open',
        closed_at       = null,
        closed_by       = null;

  insert into public.support_messages (user_id, author, author_id, body)
  values (p_user, 'admin', p_admin, v_body)
  returning * into v_row;

  update public.support_messages
     set read_at = now()
   where user_id = p_user and author = 'user' and read_at is null;

  -- The bell is how they learn a reply exists. Truncated, because a
  -- notification is a summons to the conversation, not the conversation.
  perform public.create_notification(
    p_user,
    'support',
    'Support replied',
    case when char_length(v_body) > 140 then left(v_body, 139) || '…' else v_body end,
    jsonb_build_object('thread', 'support')
  );

  return v_row;
end;
$function$
;

revoke execute on function public.admin_send_support_message(p_admin uuid, p_user uuid, p_body text)
  from public, anon, authenticated;

-- admin_set_support_status — delegated to the support role
CREATE OR REPLACE FUNCTION public.admin_set_support_status(p_admin uuid, p_user uuid, p_closed boolean)
 RETURNS support_threads
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_row public.support_threads;
begin
  perform public.assert_admin_area(p_admin, 'support');

  update public.support_threads
     set status    = case when p_closed then 'closed' else 'open' end::public.support_thread_status,
         closed_at = case when p_closed then now() else null end,
         closed_by = case when p_closed then p_admin else null end
   where user_id = p_user
  returning * into v_row;

  if not found then
    raise exception 'That conversation does not exist' using errcode = 'check_violation';
  end if;

  return v_row;
end;
$function$
;

revoke execute on function public.admin_set_support_status(p_admin uuid, p_user uuid, p_closed boolean)
  from public, anon, authenticated;

-- admin_mark_support_read — delegated to the support role
CREATE OR REPLACE FUNCTION public.admin_mark_support_read(p_admin uuid, p_user uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_n int;
begin
  perform public.assert_admin_area(p_admin, 'support');

  update public.support_messages
     set read_at = now()
   where user_id = p_user and author = 'user' and read_at is null;

  get diagnostics v_n = row_count;
  return v_n;
end;
$function$
;

revoke execute on function public.admin_mark_support_read(p_admin uuid, p_user uuid)
  from public, anon, authenticated;

-- admin_get_ad — delegated to the ads role
CREATE OR REPLACE FUNCTION public.admin_get_ad(p_admin_id uuid, p_ad_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_ad        jsonb;
  v_questions jsonb;
  v_qindex    jsonb;
  v_oindex    jsonb;
begin
  perform public.assert_admin_area(p_admin_id, 'ads');

  select coalesce(jsonb_object_agg(s.id::text, s.ix - 1), '{}'::jsonb)
    into v_qindex
  from (
    select q.id, row_number() over (order by q.position, q.created_at) as ix
      from public.ad_questions q
     where q.ad_id = p_ad_id
  ) s;

  select coalesce(jsonb_object_agg(s.id::text, s.ix - 1), '{}'::jsonb)
    into v_oindex
  from (
    select o.id,
           row_number() over (
             partition by o.question_id order by o.sort_order, o.created_at
           ) as ix
      from public.ad_question_options o
      join public.ad_questions q on q.id = o.question_id
     where q.ad_id = p_ad_id
  ) s;

  select coalesce(jsonb_agg(s.payload order by s.ord), '[]'::jsonb)
    into v_questions
  from (
    select
      row_number() over (order by q.position, q.created_at) as ord,
      jsonb_build_object(
        'question_text',   q.question_text,
        'answer_format',   q.answer_format,
        'correct_answer',  q.correct_answer,
        'show_at_seconds', q.show_at_seconds,
        'condition_mode',  q.condition_mode,
        'options', coalesce((
          select jsonb_agg(
                   jsonb_build_object('option_text', o.option_text, 'is_correct', o.is_correct)
                   order by o.sort_order, o.created_at)
            from public.ad_question_options o
           where o.question_id = q.id
        ), '[]'::jsonb),
        'rules', coalesce((
          select jsonb_agg(
                   jsonb_build_object(
                     'depends_on_index', (v_qindex ->> r.depends_on_question_id::text)::int,
                     'option_index',     case when r.option_id is null then null
                                              else (v_oindex ->> r.option_id::text)::int end,
                     'value_text',       r.value_text,
                     'negate',           r.negate)
                   order by r.created_at)
            from public.ad_question_rules r
           where r.question_id = q.id
        ), '[]'::jsonb)
      ) as payload
      from public.ad_questions q
     where q.ad_id = p_ad_id
  ) s;

  select to_jsonb(a) - 'created_by'
         || jsonb_build_object(
              'attempts_count',
                (select count(*)::int from public.ad_attempts x where x.ad_id = a.id),
              'questions_locked',
                a.completions_count > 0
                and exists (select 1 from public.ad_questions q where q.ad_id = a.id),
              'tier_ids',
                coalesce((select jsonb_agg(x.tier_id) from public.ad_tiers x where x.ad_id = a.id),
                         '[]'::jsonb),
              'questions', v_questions
            )
    into v_ad
  from public.ads a
  where a.id = p_ad_id;

  if v_ad is null then
    raise exception 'Unknown ad' using errcode = 'check_violation';
  end if;

  return v_ad;
end;
$function$
;

revoke execute on function public.admin_get_ad(p_admin_id uuid, p_ad_id uuid)
  from public, anon, authenticated;

-- admin_save_ad — delegated to the ads role
CREATE OR REPLACE FUNCTION public.admin_save_ad(p_admin_id uuid, p_ad jsonb, p_questions jsonb DEFAULT '[]'::jsonb, p_tier_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_id      uuid := nullif(p_ad ->> 'id', '')::uuid;
  v_done    int := 0;
  v_q       jsonb;
  v_qid     uuid;
  v_oid     uuid;
  v_qids    uuid[] := '{}';
  v_opts    jsonb := '{}'::jsonb;
  v_rule    jsonb;
  v_dep     int;
  v_optix   int;
  i         int;
  j         int;
begin
  perform public.assert_admin_area(p_admin_id, 'ads');

  if v_id is null then
    insert into public.ads (
      title, description, advertiser_name, format, status, points_reward,
      video_source, storage_path, youtube_video_id, thumbnail_path,
      duration_seconds, min_watch_seconds, max_completions, weight,
      starts_at, ends_at, cta_label, cta_links, created_by
    )
    values (
      p_ad ->> 'title',
      nullif(p_ad ->> 'description', ''),
      nullif(p_ad ->> 'advertiser_name', ''),
      (p_ad ->> 'format')::public.ad_format,
      coalesce((p_ad ->> 'status')::public.ad_status, 'draft'),
      (p_ad ->> 'points_reward')::bigint,
      nullif(p_ad ->> 'video_source', '')::public.video_source,
      nullif(p_ad ->> 'storage_path', ''),
      nullif(p_ad ->> 'youtube_video_id', ''),
      nullif(p_ad ->> 'thumbnail_path', ''),
      nullif(p_ad ->> 'duration_seconds', '')::int,
      nullif(p_ad ->> 'min_watch_seconds', '')::int,
      nullif(p_ad ->> 'max_completions', '')::int,
      coalesce(nullif(p_ad ->> 'weight', '')::int, 100),
      nullif(p_ad ->> 'starts_at', '')::timestamptz,
      nullif(p_ad ->> 'ends_at', '')::timestamptz,
      nullif(p_ad ->> 'cta_label', ''),
      coalesce(p_ad -> 'cta_links', '[]'::jsonb),
      p_admin_id
    )
    returning id into v_id;
  else
    update public.ads set
      title            = coalesce(p_ad ->> 'title', title),
      description      = nullif(p_ad ->> 'description', ''),
      advertiser_name  = nullif(p_ad ->> 'advertiser_name', ''),
      status           = coalesce((p_ad ->> 'status')::public.ad_status, status),
      points_reward    = coalesce((p_ad ->> 'points_reward')::bigint, points_reward),
      video_source     = nullif(p_ad ->> 'video_source', '')::public.video_source,
      storage_path     = nullif(p_ad ->> 'storage_path', ''),
      youtube_video_id = nullif(p_ad ->> 'youtube_video_id', ''),
      thumbnail_path   = nullif(p_ad ->> 'thumbnail_path', ''),
      duration_seconds = nullif(p_ad ->> 'duration_seconds', '')::int,
      min_watch_seconds= nullif(p_ad ->> 'min_watch_seconds', '')::int,
      max_completions  = nullif(p_ad ->> 'max_completions', '')::int,
      weight           = coalesce(nullif(p_ad ->> 'weight', '')::int, weight),
      starts_at        = nullif(p_ad ->> 'starts_at', '')::timestamptz,
      ends_at          = nullif(p_ad ->> 'ends_at', '')::timestamptz,
      cta_label        = nullif(p_ad ->> 'cta_label', ''),
      cta_links        = coalesce(p_ad -> 'cta_links', '[]'::jsonb),
      updated_at       = now()
    where id = v_id;

    if not found then
      raise exception 'Unknown ad' using errcode = 'check_violation';
    end if;
  end if;

  delete from public.ad_tiers where ad_id = v_id;
  if p_tier_ids is not null and array_length(p_tier_ids, 1) > 0 then
    insert into public.ad_tiers (ad_id, tier_id)
    select v_id, t from unnest(p_tier_ids) t
    on conflict do nothing;
  end if;

  select completions_count into v_done from public.ads where id = v_id;

  if p_questions is not null and jsonb_array_length(p_questions) >= 0 then
    if v_done > 0 and exists (select 1 from public.ad_questions where ad_id = v_id) then
      return v_id;
    end if;

    delete from public.ad_questions where ad_id = v_id;

    for i in 0 .. jsonb_array_length(p_questions) - 1 loop
      v_q := p_questions -> i;

      insert into public.ad_questions (
        ad_id, position, question_text, answer_format, correct_answer,
        show_at_seconds, condition_mode
      )
      values (
        v_id, i,
        v_q ->> 'question_text',
        (v_q ->> 'answer_format')::public.answer_format,
        nullif(v_q ->> 'correct_answer', ''),
        nullif(v_q ->> 'show_at_seconds', '')::int,
        coalesce((v_q ->> 'condition_mode')::public.question_condition_mode, 'all')
      )
      returning id into v_qid;

      v_qids := v_qids || v_qid;

      for j in 0 .. coalesce(jsonb_array_length(v_q -> 'options'), 0) - 1 loop
        insert into public.ad_question_options (question_id, option_text, is_correct, sort_order)
        values (
          v_qid,
          (v_q -> 'options' -> j) ->> 'option_text',
          coalesce(((v_q -> 'options' -> j) ->> 'is_correct')::boolean, false),
          j
        )
        returning id into v_oid;

        v_opts := v_opts || jsonb_build_object(i || '.' || j, v_oid);
      end loop;
    end loop;

    for i in 0 .. jsonb_array_length(p_questions) - 1 loop
      v_q := p_questions -> i;
      for j in 0 .. coalesce(jsonb_array_length(v_q -> 'rules'), 0) - 1 loop
        v_rule := v_q -> 'rules' -> j;
        v_dep  := (v_rule ->> 'depends_on_index')::int;
        v_optix := nullif(v_rule ->> 'option_index', '')::int;

        insert into public.ad_question_rules (
          question_id, depends_on_question_id, option_id, value_text, negate
        )
        values (
          v_qids[i + 1],
          v_qids[v_dep + 1],
          case when v_optix is null then null
               else (v_opts ->> (v_dep || '.' || v_optix))::uuid end,
          nullif(v_rule ->> 'value_text', ''),
          coalesce((v_rule ->> 'negate')::boolean, false)
        );
      end loop;
    end loop;
  end if;

  return v_id;
end;
$function$
;

revoke execute on function public.admin_save_ad(p_admin_id uuid, p_ad jsonb, p_questions jsonb, p_tier_ids uuid[])
  from public, anon, authenticated;

-- admin_delete_ad — delegated to the ads role
CREATE OR REPLACE FUNCTION public.admin_delete_ad(p_admin_id uuid, p_ad_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_done     int;
  v_attempts int;
begin
  perform public.assert_admin_area(p_admin_id, 'ads');

  select completions_count into v_done from public.ads where id = p_ad_id;
  if v_done is null then
    raise exception 'Unknown ad' using errcode = 'check_violation';
  end if;

  select count(*) into v_attempts from public.ad_attempts where ad_id = p_ad_id;

  if v_done = 0 and v_attempts = 0 then
    delete from public.ads where id = p_ad_id;
    return 'deleted';
  end if;

  update public.ads
     set status = 'archived', updated_at = now()
   where id = p_ad_id;
  return 'archived';
end;
$function$
;

revoke execute on function public.admin_delete_ad(p_admin_id uuid, p_ad_id uuid)
  from public, anon, authenticated;

-- admin_set_ad_status — delegated to the ads role
CREATE OR REPLACE FUNCTION public.admin_set_ad_status(p_admin_id uuid, p_ad_id uuid, p_status ad_status)
 RETURNS ad_status
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_ad public.ads%rowtype;
begin
  perform public.assert_admin_area(p_admin_id, 'ads');

  select * into v_ad from public.ads where id = p_ad_id;
  if not found then
    raise exception 'Unknown ad' using errcode = 'check_violation';
  end if;

  if p_status = 'active'
     and v_ad.max_completions is not null
     and v_ad.completions_count >= v_ad.max_completions then
    raise exception 'This ad has already delivered its whole budget. Raise the number of completions before setting it live.'
      using errcode = 'check_violation';
  end if;

  update public.ads
     set status = p_status, updated_at = now()
   where id = p_ad_id;

  return p_status;
end;
$function$
;

revoke execute on function public.admin_set_ad_status(p_admin_id uuid, p_ad_id uuid, p_status ad_status)
  from public, anon, authenticated;

-- admin_save_advertiser — delegated to the ads role
CREATE OR REPLACE FUNCTION public.admin_save_advertiser(p_admin_id uuid, p_advertiser jsonb)
 RETURNS advertisers
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_id   uuid := nullif(p_advertiser ->> 'id', '')::uuid;
  v_name text := trim(coalesce(p_advertiser ->> 'name', ''));
  v_out  public.advertisers;
begin
  perform public.assert_admin_area(p_admin_id, 'ads');

  if length(v_name) < 2 then
    raise exception 'An advertiser needs a name' using errcode = 'check_violation';
  end if;

  -- Checked here as well as by the unique index, because the index raises
  -- 23505 with a constraint name and this raises a sentence.
  if exists (
    select 1 from public.advertisers a
     where lower(trim(a.name)) = lower(v_name)
       and (v_id is null or a.id <> v_id)
  ) then
    raise exception 'There is already an advertiser called %', v_name
      using errcode = 'check_violation';
  end if;

  if v_id is null then
    insert into public.advertisers (name, contact, status, started_at, ends_at, notes, created_by)
    values (
      v_name,
      nullif(trim(coalesce(p_advertiser ->> 'contact', '')), ''),
      coalesce(nullif(p_advertiser ->> 'status', ''), 'pending')::public.advertiser_status,
      coalesce((p_advertiser ->> 'startedAt')::timestamptz, now()),
      (p_advertiser ->> 'endsAt')::timestamptz,
      nullif(trim(coalesce(p_advertiser ->> 'notes', '')), ''),
      p_admin_id
    )
    returning * into v_out;
  else
    update public.advertisers
       set name       = v_name,
           contact    = nullif(trim(coalesce(p_advertiser ->> 'contact', '')), ''),
           status     = coalesce(nullif(p_advertiser ->> 'status', ''), status::text)::public.advertiser_status,
           started_at = coalesce((p_advertiser ->> 'startedAt')::timestamptz, started_at),
           ends_at    = (p_advertiser ->> 'endsAt')::timestamptz,
           notes      = nullif(trim(coalesce(p_advertiser ->> 'notes', '')), ''),
           updated_at = now()
     where id = v_id
    returning * into v_out;

    if not found then
      raise exception 'Unknown advertiser' using errcode = 'check_violation';
    end if;
  end if;

  return v_out;
end;
$function$
;

revoke execute on function public.admin_save_advertiser(p_admin_id uuid, p_advertiser jsonb)
  from public, anon, authenticated;

-- admin_delete_advertiser — delegated to the ads role
CREATE OR REPLACE FUNCTION public.admin_delete_advertiser(p_admin_id uuid, p_advertiser_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_payments int;
begin
  perform public.assert_admin_area(p_admin_id, 'ads');

  select count(*) into v_payments
    from public.advertiser_payments p where p.advertiser_id = p_advertiser_id;

  if v_payments > 0 then
    update public.advertisers
       set status = 'ended', ends_at = coalesce(ends_at, now()), updated_at = now()
     where id = p_advertiser_id;

    if not found then
      raise exception 'Unknown advertiser' using errcode = 'check_violation';
    end if;
    return 'ended';
  end if;

  delete from public.advertisers where id = p_advertiser_id;
  if not found then
    raise exception 'Unknown advertiser' using errcode = 'check_violation';
  end if;
  return 'deleted';
end;
$function$
;

revoke execute on function public.admin_delete_advertiser(p_admin_id uuid, p_advertiser_id uuid)
  from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 10. Finding somebody by the email a super admin typed
-- ---------------------------------------------------------------------------
--
-- Inviting an administrator starts with an email address and nothing else, and
-- an address may already belong to an account — a user being promoted to
-- support, or an administrator being invited a second time by mistake. The
-- Supabase admin API can fetch a user by ID but not by address without paging
-- through every account, so the lookup lives here.
--
-- It returns an id or null and nothing else. An address that is not registered
-- must not be distinguishable from one that is by anything richer than that.

create or replace function public.admin_user_id_by_email(p_admin_id uuid, p_email text)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_id uuid;
begin
  perform public.assert_admin(p_admin_id);

  select u.id into v_id
    from auth.users u
   where lower(u.email) = lower(btrim(p_email))
   limit 1;

  return v_id;
end;
$$;

revoke execute on function public.admin_user_id_by_email(uuid, text)
  from public, anon, authenticated;
