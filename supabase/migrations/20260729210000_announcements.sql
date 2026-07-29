-- ---------------------------------------------------------------------------
-- Announcements — one message from the operator to everybody
-- ---------------------------------------------------------------------------
--
-- `broadcast_notification` has existed since the notifications work and no
-- screen has ever called it. It is sound as a primitive (one row per active
-- profile, disabled accounts excluded) and short of two things an operator
-- needs:
--
--   1. IT ASSERTS NOTHING. Every admin write in this app runs through the
--      service client where auth.uid() is null, so calling it directly would
--      send in nobody's name — the defect migration 053 fixed everywhere else.
--   2. IT REMEMBERS NOTHING. Once sent, the only trace is N notification rows
--      scattered across N people. There is no way to answer "what did we tell
--      everyone last Tuesday, and how many received it?"
--
-- So the primitive stays and this wraps it.

create table public.announcements (
  id              uuid primary key default gen_random_uuid(),
  -- Nullable only because an administrator's account could later be deleted;
  -- it is never null at the moment of sending.
  sent_by         uuid references public.profiles(id) on delete set null,
  title           text not null check (char_length(btrim(title)) between 1 and 120),
  body            text not null check (char_length(btrim(body)) between 1 and 1000),
  -- Who it went to. Only 'all' today; the column exists so adding segments
  -- later does not need a migration on a table that already has history.
  audience        text not null default 'all',
  -- Counted at send time. Deriving it later would drift as people join,
  -- leave and clear their notifications, and "how many did we reach" is a
  -- fact about that moment.
  recipient_count int not null,
  created_at      timestamptz not null default now()
);

create index announcements_recent_idx on public.announcements (created_at desc);

alter table public.announcements enable row level security;
-- No policies at all: this table is read and written only through the
-- security-definer functions below, both revoked from client roles. Users
-- experience an announcement as their own notification row, not as this.

comment on table public.announcements is
  'What the operator has told everybody, and how many received it. Sent through admin_broadcast_announcement.';


-- ---------------------------------------------------------------------------
-- Sending one
-- ---------------------------------------------------------------------------
--
-- THE TYPE IS NOT A PARAMETER, deliberately. The notification cards are
-- coloured by type and each colour means something the user has learned to
-- trust: green is money arriving, red is something wrong with your account.
-- An operator composing a message must not be able to dress it as either, so
-- an announcement is always an announcement.

create function public.admin_broadcast_announcement(
  p_admin uuid,
  p_title text,
  p_body  text
)
returns public.announcements
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_title text := btrim(coalesce(p_title, ''));
  v_body  text := btrim(coalesce(p_body, ''));
  v_count int;
  v_row   public.announcements;
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

  -- The existing primitive does the insert, so there is one definition of who
  -- counts as a recipient (active profiles) rather than two that can drift.
  v_count := public.broadcast_notification('announcement', v_title, v_body, null);

  insert into public.announcements (sent_by, title, body, audience, recipient_count)
  values (p_admin, v_title, v_body, 'all', v_count)
  returning * into v_row;

  return v_row;
end;
$$;

revoke execute on function public.admin_broadcast_announcement(uuid, text, text)
  from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- Reading them back
-- ---------------------------------------------------------------------------

create function public.admin_list_announcements(p_limit int default 50)
returns table (
  id              uuid,
  title           text,
  body            text,
  audience        text,
  recipient_count int,
  sent_by_name    text,
  created_at      timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  -- Same guard as admin_list_people: a browser token must be an admin's, and
  -- a null caller is the service client.
  if (select auth.uid()) is not null and not public.is_admin() then
    raise exception 'Not an administrator' using errcode = 'insufficient_privilege';
  end if;

  return query
  select a.id, a.title, a.body, a.audience, a.recipient_count,
         coalesce(p.full_name, 'Administrator'),
         a.created_at
    from public.announcements a
    left join public.profiles p on p.id = a.sent_by
   order by a.created_at desc
   limit greatest(1, least(coalesce(p_limit, 50), 200));
end;
$$;

revoke execute on function public.admin_list_announcements(int) from public, anon;
grant  execute on function public.admin_list_announcements(int) to authenticated, service_role;

-- How many people the next one would reach, so the operator sees the number
-- BEFORE they send rather than after. Same definition of "active" the
-- broadcast itself uses.
create function public.admin_announcement_audience()
returns int
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_n int;
begin
  if (select auth.uid()) is not null and not public.is_admin() then
    raise exception 'Not an administrator' using errcode = 'insufficient_privilege';
  end if;

  select count(*)::int into v_n from public.profiles where disabled_at is null;
  return v_n;
end;
$$;

revoke execute on function public.admin_announcement_audience() from public, anon;
grant  execute on function public.admin_announcement_audience() to authenticated, service_role;
