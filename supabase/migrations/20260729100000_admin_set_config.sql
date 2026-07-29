-- ============================================================================
-- Migration 052 — the only way to write app_config
--
-- §2.1 requires every rate, cap, threshold and bonus to be editable without a
-- deploy. The table has existed since migration 004 and the admin screen has
-- rendered its fields since the dashboard was designed, but there has never
-- been a write path: `app_config` has a SELECT policy and no INSERT, UPDATE or
-- DELETE policy for any role, so nothing short of a service-role statement
-- could change a value. In practice that meant me, running SQL.
--
-- WHY A FUNCTION RATHER THAN A WRITE POLICY
-- A policy would let an admin's browser token write the row directly, and
-- there are three rules that have to hold on every write which a policy cannot
-- express:
--
--   1. The key must already exist. Writing an unknown key does not fail — it
--      INSERTs a setting nothing reads, which looks like it worked and
--      silently does nothing forever.
--   2. The value must match the row's own declared type and bounds. The table
--      CHECKs enforce this, but they raise "violates check constraint
--      app_config_value_in_range", which tells an operator nothing about
--      which field or what the limit was.
--   3. Some values are only meaningful from a fixed set, and the set lives in
--      a different function. See the combine mode below.
--
-- WHAT IT RETURNS AND WHY
-- One row per setting that ACTUALLY changed, with its old and new value.
-- Unchanged keys are skipped rather than rewritten: re-saving a form should
-- not stamp `updated_by` on forty rows nobody touched, and it should not fill
-- the audit log with entries that record no change. The caller gets back
-- exactly what it can honestly tell the operator happened.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- Values that are only meaningful from a fixed set
-- ---------------------------------------------------------------------------
--
-- `subscription_multiplier_combine_mode` is `text` in app_config, so the
-- table's own CHECKs cannot constrain it — a text row has no bounds. But
-- `resolve_user_tier` branches on it:
--
--   sum_bonus | sum | product   each computes something specific
--   anything else               falls through to `max(reward_multiplier)`
--
-- so an unrecognised mode does not error. It quietly changes how every
-- subscriber's reward multiplier is calculated and looks like it saved fine.
-- The admin screen offered `multiply` for months, which is not one of the
-- implemented branches and would have silently behaved as `highest`.
--
-- `highest` IS listed, because the else-branch implements exactly that and the
-- referral arm names it explicitly. It is a real mode; it just happens to be
-- spelled as a fallback.

create or replace function public.config_allowed_values(p_key text)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select case p_key
    when 'subscription_multiplier_combine_mode'
      then array['sum_bonus', 'sum', 'product', 'highest']
    else null
  end;
$$;

comment on function public.config_allowed_values(text) is
  'The fixed set a text setting may take, or null when it is free-form. Exists because app_config cannot express an enum and an unrecognised value fails silently rather than loudly.';


-- ---------------------------------------------------------------------------
-- admin_set_config
-- ---------------------------------------------------------------------------

create or replace function public.admin_set_config(
  p_admin_id uuid,
  p_values   jsonb
)
returns table (
  config_key     text,
  previous_value text,
  new_value      text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key     text;
  v_new     text;
  v_row     public.app_config;
  v_allowed text[];
begin
  perform public.assert_admin(p_admin_id);

  if p_values is null or jsonb_typeof(p_values) <> 'object' then
    raise exception 'Expected an object of setting/value pairs'
      using errcode = 'check_violation';
  end if;

  for v_key, v_new in
    select e.k, e.v from jsonb_each_text(p_values) as e(k, v)
  loop
    -- FOR UPDATE: two operators saving overlapping settings serialise rather
    -- than interleaving. These are single rows, so the lock is cheap and the
    -- alternative is a last-writer-wins race on numbers that decide payouts.
    select * into v_row from public.app_config c where c.key = v_key for update;

    if not found then
      -- Never INSERT. A typo'd key that creates a row is a setting the
      -- operator believes they changed and nothing ever reads.
      raise exception 'Unknown setting: %', v_key using errcode = 'check_violation';
    end if;

    if v_new is null then
      raise exception '% cannot be empty', v_key using errcode = 'check_violation';
    end if;

    -- --- Shape, with a message that names the field ------------------------
    if v_row.value_type = 'int' and v_new !~ '^-?\d+$' then
      raise exception '% must be a whole number', v_key using errcode = 'check_violation';
    end if;

    if v_row.value_type = 'decimal' and v_new !~ '^-?\d+(\.\d+)?$' then
      raise exception '% must be a number', v_key using errcode = 'check_violation';
    end if;

    if v_row.value_type = 'bool' and v_new not in ('true', 'false') then
      raise exception '% must be true or false', v_key using errcode = 'check_violation';
    end if;

    -- --- Range, from the row's own metadata --------------------------------
    if v_row.value_type in ('int', 'decimal') then
      if v_row.min_value is not null and v_new::numeric < v_row.min_value then
        raise exception '% must be at least %', v_key, v_row.min_value
          using errcode = 'check_violation';
      end if;
      if v_row.max_value is not null and v_new::numeric > v_row.max_value then
        raise exception '% must be at most %', v_key, v_row.max_value
          using errcode = 'check_violation';
      end if;
    end if;

    -- --- Fixed sets --------------------------------------------------------
    v_allowed := public.config_allowed_values(v_key);
    if v_allowed is not null and not (v_new = any (v_allowed)) then
      raise exception '% must be one of: %', v_key, array_to_string(v_allowed, ', ')
        using errcode = 'check_violation';
    end if;

    -- --- Write, but only when it is a change -------------------------------
    if v_row.value is not distinct from v_new then
      continue;
    end if;

    update public.app_config
       set value = v_new,
           -- The stamp trigger uses coalesce(auth.uid(), new.updated_by), and
           -- auth.uid() is null through the service client, so naming the
           -- admin here is what keeps the attribution real.
           updated_by = p_admin_id
     where key = v_key;

    config_key     := v_key;
    previous_value := v_row.value;
    new_value      := v_new;
    return next;
  end loop;
end;
$$;

comment on function public.admin_set_config(uuid, jsonb) is
  'The only write path for app_config. Verifies the admin, refuses unknown keys, validates each value against that row own type/bounds and any fixed set, and returns only the settings that actually changed.';

revoke execute on function public.admin_set_config(uuid, jsonb) from public, anon, authenticated;
