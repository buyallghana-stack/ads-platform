-- ============================================================================
-- Migration 182 — community links
--
-- Operator, 2026-08-12: a Community feature on the profile tab. They add a
-- link and a community name, the name carrying the platform, and a user sees
-- the name and taps it to join. Admin configurable.
--
-- ── THE NAME IS THE WHOLE INTERFACE ──
--
-- "Users should only see the community name." So the row carries a name and a
-- url and the url is never rendered as text. The platform is stored anyway,
-- but only to choose an icon: a list of five identical rows is worse at
-- telling somebody where they are going than one glyph does instantly, and an
-- icon is not text, so the operator's rule holds.
--
-- ── A URL A USER TAPS IS AN ATTACK SURFACE ──
--
-- Anything stored here is a link the platform is vouching for, on a screen
-- inside the product. Two constraints keep that honest:
--
--   `communities_url_https` refuses anything that is not https. A `javascript:`
--   url in an anchor is script execution on our origin, and a plain http link
--   is a downgrade somebody's network can read.
--   `communities_name_shape` refuses an empty or absurdly long name, because
--   the name is the only thing the user reads before deciding to go.
--
-- The screen adds `rel="noopener noreferrer"` and `target="_blank"`, which is
-- what stops the destination reaching back through `window.opener`.
--
-- ── READ BY ANYBODY SIGNED IN, WRITTEN BY A SUPER ADMIN ──
--
-- The select policy is deliberately not `is_admin()`: every user needs to read
-- the active rows, and there is nothing private in a link the operator is
-- publishing. Inactive rows stay admin-only, so switching one off removes it
-- from the app rather than merely hiding it in one component.
-- ============================================================================

do $$
begin
  if not exists (select 1 from pg_type where typname = 'community_platform') then
    create type public.community_platform as enum
      ('whatsapp', 'telegram', 'x', 'instagram', 'facebook', 'tiktok', 'other');
  end if;
end;
$$;

create table if not exists public.communities (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  platform    public.community_platform not null default 'other',
  url         text not null,
  /* Which business it belongs to. `both` is the default because a community is
     usually the whole product, not half of it, and the affiliate tab can carry
     its own where that is not true. */
  business    public.notification_business not null default 'both',
  is_active   boolean not null default true,
  sort_order  int not null default 0,
  created_by  uuid references auth.users(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint communities_name_shape check (length(btrim(name)) between 1 and 60),
  constraint communities_url_https  check (url ~* '^https://[^\s]{3,500}$')
);

create index if not exists communities_live_idx
  on public.communities (business, sort_order) where is_active;

drop trigger if exists communities_touch_updated_at on public.communities;
create trigger communities_touch_updated_at
  before update on public.communities
  for each row execute function public.touch_updated_at();

alter table public.communities enable row level security;

create policy communities_read_live on public.communities
  for select to authenticated
  using (is_active or public.is_admin());


-- ---------------------------------------------------------------------------
-- The admin
-- ---------------------------------------------------------------------------

create or replace function public.admin_save_community(
  p_admin_id uuid,
  p_id uuid,
  p_name text,
  p_platform public.community_platform,
  p_url text,
  p_business public.notification_business,
  p_is_active boolean,
  p_sort_order int
)
returns public.communities
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.communities;
  v_url text := btrim(coalesce(p_url, ''));
begin
  perform public.assert_admin(p_admin_id);

  if length(btrim(coalesce(p_name, ''))) = 0 then
    raise exception 'Give the community a name' using errcode = 'check_violation';
  end if;

  /* Said here in the operator's language. The constraint underneath is the
     guarantee; this is the sentence they read when they paste a link copied
     out of a browser bar that dropped the scheme. */
  if v_url !~* '^https://' then
    raise exception 'A community link has to start with https://'
      using errcode = 'check_violation';
  end if;

  if p_id is null then
    insert into public.communities (name, platform, url, business, is_active, sort_order, created_by)
    values (btrim(p_name), coalesce(p_platform, 'other'), v_url,
            coalesce(p_business, 'both'), coalesce(p_is_active, true),
            coalesce(p_sort_order, 0), p_admin_id)
    returning * into v_row;
  else
    update public.communities set
      name = btrim(p_name),
      platform = coalesce(p_platform, 'other'),
      url = v_url,
      business = coalesce(p_business, 'both'),
      is_active = coalesce(p_is_active, true),
      sort_order = coalesce(p_sort_order, 0)
     where id = p_id
    returning * into v_row;

    if not found then
      raise exception 'Unknown community' using errcode = 'check_violation';
    end if;
  end if;

  return v_row;
end;
$$;

create or replace function public.admin_delete_community(p_admin_id uuid, p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.assert_admin(p_admin_id);
  delete from public.communities where id = p_id;
end;
$$;

/* ⚠️ `create function` grants EXECUTE to PUBLIC. Migrations 103 and 104 exist
   because seventeen functions were reachable with the publishable key. */
revoke execute on function public.admin_save_community(uuid, uuid, text,
  public.community_platform, text, public.notification_business, boolean, int)
  from public, anon, authenticated;
revoke execute on function public.admin_delete_community(uuid, uuid) from public, anon, authenticated;
grant execute on function public.admin_save_community(uuid, uuid, text,
  public.community_platform, text, public.notification_business, boolean, int) to service_role;
grant execute on function public.admin_delete_community(uuid, uuid) to service_role;
