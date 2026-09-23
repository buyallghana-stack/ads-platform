-- ============================================================================
-- Migration 192 — starting the walkthrough is not the same as finishing step 1
--
-- ⚠️ THE FIRST STEP WAS NEVER SHOWN TO ANYBODY. The welcome sheet had no way
-- to say "this member has begun" other than to mark a step, so it marked
-- `balance`. That created the row, which is what it wanted, and also consumed
-- step one, which it did not: a real member pressed "Show me around" and
-- landed on step TWO, having never been shown their own balance. The
-- screenshots that looked right were taken by a script that seeded the row
-- directly, so it never went through the sheet and never saw this.
--
-- `started` is a fact about the account, not about a step, and it now has its
-- own way to be recorded.
-- ============================================================================

create or replace function public.start_onboarding()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then
    raise exception 'Not signed in' using errcode = 'check_violation';
  end if;

  /* Creates the row and nothing else. `seen_steps` stays empty, so the
     walkthrough opens on whatever the operator has ordered first. Repeating it
     is harmless: somebody who reopens the welcome sheet must not have their
     progress reset, so an existing row is left exactly as it is. */
  insert into public.user_onboarding (user_id)
  values (v_me)
  on conflict (user_id) do nothing;

  return public.get_onboarding_state(v_me);
end;
$$;

revoke execute on function public.start_onboarding() from public, anon;
grant  execute on function public.start_onboarding() to authenticated;
