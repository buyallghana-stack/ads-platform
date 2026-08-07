-- ---------------------------------------------------------------------------
-- Recording that an affiliate accepted the terms, and which version.
--
-- Decision H47: no affiliate agreement is being drafted, but the versioned
-- acceptance MECHANISM ships anyway, because it cannot be added
-- retroactively. `affiliate_accounts.terms_version` and `terms_accepted_at`
-- have existed since the table was created and nothing has ever written them,
-- so every affiliate to date has joined with no record of what they agreed to.
--
-- ── WHY A TRIGGER AND NOT A LINE IN THE JOIN CODE ──
--
-- An affiliate account is created in FOUR places: buying training, the
-- attribution path, the commission path and the renewal path. A stamp written
-- at one of them is a stamp missing from three, and the one that gets missed
-- is discovered a year later when somebody asks what a particular affiliate
-- signed up to. A BEFORE INSERT trigger cannot be forgotten by a fifth path
-- that has not been written yet.
--
-- ── WHAT "THE TERMS" MEANS HERE ──
--
-- The platform Terms, which cover affiliate activity since section 12 was
-- rewritten. `affiliate_terms_version` is an integer the operator bumps when
-- the wording changes materially; an accepted row keeps the version it was
-- accepted under, which is the entire point of versioning it. Nothing is
-- blocked when the version moves ahead of somebody's acceptance: H47 asks for
-- the record, not for a gate, and a gate that locked people out of their own
-- earnings would be a worse answer than a report.
-- ---------------------------------------------------------------------------

insert into public.app_config (key, value, value_type, min_value, max_value, is_public, description)
values
  ('affiliate_terms_version', '1', 'int', 1, 999, false,
   'Which version of the terms a new affiliate is recorded as accepting. Bump it when the wording changes materially; existing acceptances keep the version they were given.')
on conflict (key) do nothing;

create or replace function public.stamp_affiliate_terms()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  /* Only on the way in, and only when the caller has not said otherwise: a
     backfill or an import may carry its own version, and overwriting that
     would be rewriting somebody's record. */
  if new.terms_version is null then
    new.terms_version := coalesce(public.config_int('affiliate_terms_version'), 1);
    new.terms_accepted_at := coalesce(new.terms_accepted_at, now());
  end if;

  return new;
end;
$$;

drop trigger if exists affiliate_accounts_stamp_terms on public.affiliate_accounts;
create trigger affiliate_accounts_stamp_terms
  before insert on public.affiliate_accounts
  for each row execute function public.stamp_affiliate_terms();

/**
 * Who has accepted what, for the admin.
 *
 * ⚠️ The accounts that predate this show `accepted_at` NULL, and the screen
 * says "not recorded" rather than inventing a date. Backfilling them with
 * today's date would be a lie about when they agreed, and backfilling with
 * their join date would be a lie about their having agreed at all.
 */
create or replace function public.admin_affiliate_terms_status(p_admin_id uuid)
returns table (
  affiliate_id uuid,
  name text,
  affiliate_code text,
  terms_version int,
  terms_accepted_at timestamptz,
  current_version int,
  is_current boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_current int := coalesce(public.config_int('affiliate_terms_version'), 1);
begin
  perform public.assert_admin(p_admin_id);

  return query
  select a.id,
         coalesce(p.full_name, '')::text,
         a.affiliate_code,
         a.terms_version,
         a.terms_accepted_at,
         v_current,
         a.terms_version is not null and a.terms_version >= v_current
    from public.affiliate_accounts a
    join public.profiles p on p.id = a.user_id
   order by a.terms_accepted_at nulls first, a.created_at;
end;
$$;

revoke execute on function public.stamp_affiliate_terms() from public, anon, authenticated;
revoke execute on function public.admin_affiliate_terms_status(uuid)
  from public, anon, authenticated;
grant execute on function public.admin_affiliate_terms_status(uuid) to service_role;
