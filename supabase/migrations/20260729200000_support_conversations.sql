-- ---------------------------------------------------------------------------
-- Support conversations — the message backend /admin/messages was drawn for
-- ---------------------------------------------------------------------------
--
-- The operator chose an in-house inbox answered by people, over a third-party
-- widget, for one reason worth writing down: the question support actually
-- gets here is "why is my withdrawal on hold", and the answer lives in this
-- database. A vendor console would show the sentence and none of the account.
--
-- SHAPE: ONE THREAD PER PERSON, not a ticket queue. That is what the admin
-- screen already draws — a stacked list of PEOPLE, each with their last
-- message and an unread count, not a list of subjects. Somebody who writes
-- twice about two things is still one conversation, exactly as it would be on
-- a phone.

create type public.support_author        as enum ('user', 'admin');
create type public.support_thread_status as enum ('open', 'closed');

create table public.support_threads (
  user_id         uuid primary key references public.profiles(id) on delete cascade,
  status          public.support_thread_status not null default 'open',
  opened_at       timestamptz not null default now(),
  -- Denormalised so the inbox can be ordered without touching the messages
  -- table, and kept honest by the functions below being the only writers.
  last_message_at timestamptz not null default now(),
  closed_at       timestamptz,
  closed_by       uuid references public.profiles(id) on delete set null
);

create table public.support_messages (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.support_threads(user_id) on delete cascade,
  author     public.support_author not null,
  -- Which administrator wrote it. Null on a user's own message, and null on
  -- an admin message only if that admin's account was later deleted.
  author_id  uuid references public.profiles(id) on delete set null,
  body       text not null check (char_length(btrim(body)) between 1 and 2000),
  -- What the person was looking at when they opened the conversation: the
  -- notification, the payout reference. Support's first question is always
  -- "which one?", and this answers it before anybody asks.
  context    jsonb,
  -- clock_timestamp(), NOT now(). `now()` is the TRANSACTION's start time, so
  -- two messages written in one transaction share it exactly and the
  -- transcript comes back in arbitrary order — caught in testing rendering a
  -- reply above the question it answered. Wall time is also simply the truer
  -- thing to stamp on a message.
  created_at timestamptz not null default clock_timestamp(),
  -- When the OTHER side read it. One column, because a message only ever has
  -- one recipient here: the user reads the admin's, the admin reads the user's.
  read_at    timestamptz
);

create index support_messages_thread_idx on public.support_messages (user_id, created_at);
create index support_messages_unread_idx on public.support_messages (user_id)
  where author = 'user' and read_at is null;
create index support_threads_recent_idx  on public.support_threads (last_message_at desc);

alter table public.support_threads  enable row level security;
alter table public.support_messages enable row level security;

-- OWN ROWS ONLY, with no `or is_admin()` branch anywhere. Administrators read
-- these through the security-definer functions below instead. That is the fix
-- migration 057 had to make to `notifications` after an admin's own dashboard
-- showed them another user's rows, and this table is a worse place to repeat
-- it: a support thread is the most personal text in the product.
create policy "Read own support thread" on public.support_threads
  for select to authenticated using (user_id = (select auth.uid()));

create policy "Read own support messages" on public.support_messages
  for select to authenticated using (user_id = (select auth.uid()));

-- No insert/update/delete policy for anybody. Every write goes through a
-- function, which is what makes the rate limit and the read-marking rules
-- unavoidable rather than merely usual.

comment on table public.support_threads  is 'One support conversation per person. Created on their first message, or by an admin opening one.';
comment on table public.support_messages is 'Messages in a support conversation. Written only through send_support_message / admin_send_support_message.';


-- ---------------------------------------------------------------------------
-- 1. What a person may send
-- ---------------------------------------------------------------------------

insert into public.app_config (key, value, value_type, min_value, max_value, is_public, description)
values
  ('support_messages_per_hour', '20', 'int', 1, 500, false,
   'How many support messages one person may send in an hour. Stops a stuck user (or a script) burying the inbox; they can still send more the next hour, and nothing they have already sent is lost.')
on conflict (key) do nothing;

-- Identity comes from the JWT, never from an argument: this one is granted to
-- `authenticated` and called with the user's own client, the same way
-- get_active_sessions is. An argument would let anyone write as anyone.
create function public.send_support_message(
  p_body    text,
  p_context jsonb default null
)
returns public.support_messages
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user  uuid := (select auth.uid());
  v_body  text := btrim(coalesce(p_body, ''));
  v_sent  int;
  v_limit int;
  v_row   public.support_messages;
begin
  if v_user is null then
    raise exception 'You must be signed in to contact support' using errcode = 'insufficient_privilege';
  end if;

  if char_length(v_body) = 0 then
    raise exception 'Write a message first' using errcode = 'check_violation';
  end if;

  if char_length(v_body) > 2000 then
    raise exception 'That message is too long. Please shorten it to 2000 characters or fewer.'
      using errcode = 'check_violation';
  end if;

  v_limit := public.config_int('support_messages_per_hour')::int;
  select count(*) into v_sent
    from public.support_messages m
   where m.user_id = v_user
     and m.author = 'user'
     and m.created_at > now() - interval '1 hour';

  if v_sent >= v_limit then
    raise exception 'You have sent a lot of messages in a short time. Please wait a little while before sending another.'
      using errcode = 'check_violation';
  end if;

  -- A reply reopens a closed conversation. Closing is the operator saying
  -- "done", not a door the person has to knock on twice.
  insert into public.support_threads (user_id, last_message_at)
  values (v_user, now())
  on conflict (user_id) do update
    set last_message_at = now(),
        status          = 'open',
        closed_at       = null,
        closed_by       = null;

  insert into public.support_messages (user_id, author, body, context)
  values (v_user, 'user', v_body, p_context)
  returning * into v_row;

  return v_row;
end;
$$;

revoke execute on function public.send_support_message(text, jsonb) from public, anon;
grant  execute on function public.send_support_message(text, jsonb) to authenticated, service_role;

-- Marks the ADMIN's messages as read. Called when the person opens the
-- conversation; it can never mark their own messages read on their behalf.
create function public.mark_support_read()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_n    int;
begin
  if v_user is null then
    return 0;
  end if;

  update public.support_messages
     set read_at = now()
   where user_id = v_user
     and author = 'admin'
     and read_at is null;

  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke execute on function public.mark_support_read() from public, anon;
grant  execute on function public.mark_support_read() to authenticated, service_role;


-- ---------------------------------------------------------------------------
-- 2. The inbox
-- ---------------------------------------------------------------------------
--
-- admin_list_people gains the three message columns and a 'messages' scope
-- rather than a second function growing beside it. There is ONE definition of
-- a person row in this system and the Messages screen renders the same card
-- as Users and Flagged — a separate list would drift the moment either side
-- gained a column.
--
-- Return type changed, so this is a drop and recreate. Regenerate the
-- TypeScript types afterwards.

drop function if exists public.admin_list_people(text);

create function public.admin_list_people(p_scope text default 'all')
returns table (
  id              uuid,
  name            text,
  email           text,
  phone           text,
  avatar_path     text,
  joined_at       timestamptz,
  balance_points  bigint,
  tier            text,
  status          text,
  flagged_by      text,
  flag_reason     text,
  lifetime_points bigint,
  ads_watched     int,
  referrals       int,
  last_active_at  timestamptz,
  paid_out_ghs    numeric,
  last_message    text,
  last_message_at timestamptz,
  unread          int
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
    p.phone,
    p.avatar_path,
    p.created_at,
    coalesce(b.balance, 0),
    (public.resolve_user_tier(p.id)).name,

    case
      when p.disabled_at is not null then 'disabled'
      when p.flagged_at  is not null then 'flagged'
      else 'active'
    end,

    case
      when p.flagged_at is null      then null
      when p.flagged_by is not null  then 'admin'
      else 'system'
    end,
    p.flagged_reason,

    coalesce(b.lifetime_earned, 0),

    (select count(*)::int from public.points_ledger l
      where l.user_id = p.id and l.entry_type in ('ad_view', 'survey')),

    (select count(*)::int from public.profiles r where r.referred_by = p.id),

    greatest(
      p.created_at,
      coalesce((select max(l.created_at) from public.points_ledger l where l.user_id = p.id), p.created_at),
      coalesce((select max(s.signed_in_at) from public.user_session_records s where s.user_id = p.id), p.created_at)
    ),

    coalesce((select sum(q.currency_amount) from public.redemptions q
               where q.user_id = p.id and q.status = 'paid'), 0),

    -- The message columns. Null for a person who has never written, which is
    -- exactly what the Users and Flagged cards want to render: nothing.
    (select m.body from public.support_messages m
      where m.user_id = p.id order by m.created_at desc limit 1),

    t.last_message_at,

    (select count(*)::int from public.support_messages m
      where m.user_id = p.id and m.author = 'user' and m.read_at is null)

  from public.profiles p
  join auth.users u on u.id = p.id
  left join public.user_balances b on b.user_id = p.id
  left join public.support_threads t on t.user_id = p.id
  where
    case p_scope
      -- Filtered in SQL, not in the browser: Flagged means the flagged ones
      -- and Messages means the ones who have actually written. A screen that
      -- fetches everybody and hides most of it has still sent everybody.
      when 'flagged'  then (p.flagged_at is not null or p.disabled_at is not null)
      when 'messages' then t.user_id is not null
      else true
    end
    -- A finalised deletion scrambles the auth row and renames the profile to
    -- 'Deleted user'. Those are not people an operator can act on.
    and p.deleted_at is null
  order by
    -- Messages is a conversation list: whoever spoke last is at the top.
    -- The key is null for every row under the other scopes, so their order is
    -- untouched — anything needing attention first, then newest.
    case when p_scope = 'messages' then t.last_message_at end desc nulls last,
    case when p.disabled_at is not null then 0
         when p.flagged_at  is not null then 1
         else 2 end,
    p.created_at desc;
end;
$$;

comment on function public.admin_list_people(text) is
  'People for the Users, Flagged and Messages screens, with the activity a flag review needs and the last support message.';

revoke execute on function public.admin_list_people(text) from public, anon;
grant  execute on function public.admin_list_people(text) to authenticated, service_role;


-- ---------------------------------------------------------------------------
-- 3. What an administrator may do
-- ---------------------------------------------------------------------------

-- The whole transcript for one person.
create function public.admin_get_support_thread(p_admin uuid, p_user uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_thread public.support_threads;
  v_out    jsonb;
begin
  perform public.assert_admin(p_admin);

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
$$;

revoke execute on function public.admin_get_support_thread(uuid, uuid) from public, anon, authenticated;

-- Replying marks everything the person sent as read: you have just answered
-- it. A separate "mark read" exists for reading without replying.
create function public.admin_send_support_message(p_admin uuid, p_user uuid, p_body text)
returns public.support_messages
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_body text := btrim(coalesce(p_body, ''));
  v_row  public.support_messages;
begin
  perform public.assert_admin(p_admin);

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
$$;

revoke execute on function public.admin_send_support_message(uuid, uuid, text) from public, anon, authenticated;

create function public.admin_mark_support_read(p_admin uuid, p_user uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare v_n int;
begin
  perform public.assert_admin(p_admin);

  update public.support_messages
     set read_at = now()
   where user_id = p_user and author = 'user' and read_at is null;

  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke execute on function public.admin_mark_support_read(uuid, uuid) from public, anon, authenticated;

-- Closed is a filing state, not a lock: the person's next message reopens it.
create function public.admin_set_support_status(p_admin uuid, p_user uuid, p_closed boolean)
returns public.support_threads
language plpgsql
security definer
set search_path = ''
as $$
declare v_row public.support_threads;
begin
  perform public.assert_admin(p_admin);

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
$$;

revoke execute on function public.admin_set_support_status(uuid, uuid, boolean) from public, anon, authenticated;

-- Drives the nav badge, which is the only thing that tells an operator
-- somebody is waiting. Counts PEOPLE, not messages: three questions from one
-- person is one conversation to answer.
create function public.admin_count_unread_support()
returns int
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_n int;
begin
  -- Same guard as admin_list_people. Without it this would hand any signed-in
  -- account a running count of how many people are waiting on support — small,
  -- but it is still the inbox talking to strangers.
  if (select auth.uid()) is not null and not public.is_admin() then
    raise exception 'Not an administrator' using errcode = 'insufficient_privilege';
  end if;

  select count(distinct m.user_id)::int into v_n
    from public.support_messages m
   where m.author = 'user' and m.read_at is null;

  return v_n;
end;
$$;

revoke execute on function public.admin_count_unread_support() from public, anon;
grant  execute on function public.admin_count_unread_support() to authenticated, service_role;

-- Status changes are somebody's decision, so they belong in the trail. The
-- messages themselves are not audited: they are already permanent, and
-- copying their text into admin_audit_log would duplicate the most personal
-- data in the product into a second table nobody reads.
create trigger audit_support_threads
  after insert or update or delete on public.support_threads
  for each row execute function public.audit_row_change('user_id');


-- ---------------------------------------------------------------------------
-- 4. A deleted person's conversation goes with them
-- ---------------------------------------------------------------------------
--
-- The privacy policy says that when an account is deleted we erase the person
-- and keep only the anonymous financial record. Support messages are the most
-- personal text in the product, so leaving them behind would make that
-- sentence untrue — and unlike the ledger there is no accounting reason to
-- keep them.
--
-- The no-financial-history branch already reaches them: `auth.users` cascades
-- to `profiles`, which cascades to `support_threads`, which cascades to the
-- messages. It is the ANONYMISE branch, where the row survives on purpose,
-- that has to say so explicitly.
--
-- RESTATED FROM THE LIVE `pg_get_functiondef` (md5 76c1b504…), not from the
-- migration that first created it — this function has been amended since, and
-- rewriting one from an old file is how three regressions got into
-- admin_list_people earlier today. One line is added; everything else is
-- byte-for-byte what was running.

create or replace function public.finalise_account_deletion(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_email     text;
  v_phone     text;
  v_financial boolean;
begin
  select u.email, p.phone into v_email, v_phone
    from auth.users u join public.profiles p on p.id = u.id
   where u.id = p_user_id;

  if v_email is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  insert into public.blocked_identities (email_hash, phone_hash)
  values (public.identity_hash(v_email),
          public.identity_hash(public.normalise_phone(v_phone)))
  on conflict do nothing;

  select exists (select 1 from public.points_ledger where user_id = p_user_id)
      or exists (select 1 from public.redemptions where user_id = p_user_id)
      or exists (select 1 from public.subscription_payments where user_id = p_user_id)
    into v_financial;

  if not v_financial then
    delete from auth.users where id = p_user_id;
    return jsonb_build_object('ok', true, 'outcome', 'deleted');
  end if;

  delete from public.user_payout_details where user_id = p_user_id;
  delete from public.user_backup_codes   where user_id = p_user_id;
  delete from public.user_security       where user_id = p_user_id;
  delete from public.user_devices        where user_id = p_user_id;
  delete from public.notifications       where user_id = p_user_id;
  delete from public.support_threads     where user_id = p_user_id;  -- messages cascade

  update public.profiles
     set full_name       = 'Deleted user',
         phone           = null,
         avatar_path     = null,
         referral_code   = 'DELETED-' || p_user_id::text,
         disabled_at     = coalesce(disabled_at, now()),
         disabled_reason = 'Account deleted at the user''s request',
         deleted_at      = now(),
         updated_at      = now()
   where id = p_user_id;

  update auth.users
     set email             = 'deleted+' || p_user_id::text || '@deleted.invalid',
         phone             = null,
         encrypted_password = null,
         email_confirmed_at = null,
         raw_user_meta_data = '{}'::jsonb,
         banned_until      = 'infinity'::timestamptz,
         updated_at        = now()
   where id = p_user_id;

  return jsonb_build_object('ok', true, 'outcome', 'anonymised');
end;
$function$;
