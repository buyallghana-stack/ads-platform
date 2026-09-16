-- ============================================================================
-- Migration 221 — the reconciliation sweep gets a clock
--
-- The sweep in /api/cron/reconcile-payments is what finishes a payment when
-- the buyer closed the tab AND the hub's forward gave up. It needs to run
-- every fifteen minutes, and Vercel cannot do it: this project is on the Hobby
-- plan, where a cron may only fire DAILY and only two may exist at all. Both
-- are taken, by the deletion purge and the exchange rate refresh, and neither
-- can be given up.
--
-- So the clock lives in the database instead, which is where the hub's own
-- outbox sweep already runs. `pg_cron` fires the job and `pg_net` makes the
-- HTTP call, both enabled here.
--
-- WHY NOT DO THE WORK IN SQL. Reconciliation has to ASK the hub what happened,
-- over a signed HTTP request, and the signing key does not belong in the
-- database. So the database only rings the bell; the application answers it
-- and does the work, behind the same CRON_SECRET the other two sweeps use.
-- ============================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

-- ----------------------------------------------------------------------------
-- Where to ring.
--
-- In config rather than hardcoded because this same migration has to be
-- correct on a preview deployment, and because a domain change should not
-- need a migration. The sweep is not user facing, so it is not public.
-- ----------------------------------------------------------------------------
insert into public.app_config (key, value, value_type, description, is_public)
values (
  'site_base_url',
  'https://sideperks.org',
  'text',
  'Origin the database calls back into for scheduled work. No trailing slash.',
  false
)
on conflict (key) do nothing;

-- ----------------------------------------------------------------------------
-- The bell.
--
-- ⚠️ THE SECRET IS NOT IN THIS FILE. It is read from Supabase Vault under the
-- name `cron_secret`, and it must be put there once per environment with
--
--     select vault.create_secret('<CRON_SECRET>', 'cron_secret',
--       'Bearer token for the scheduled routes in /api/cron');
--
-- A missing secret is a WARNING and a no-op, never an exception: a raise here
-- would make pg_cron retry a job that can never succeed, and fill the log with
-- the same failure every fifteen minutes. A quiet no-op leaves exactly one
-- line saying what to do about it.
-- ----------------------------------------------------------------------------
create or replace function public.ring_payment_reconciliation()
returns bigint
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_secret  text;
  v_base    text;
  v_request bigint;
begin
  select decrypted_secret into v_secret
    from vault.decrypted_secrets
   where name = 'cron_secret'
   limit 1;

  if v_secret is null or btrim(v_secret) = '' then
    raise warning 'Payment reconciliation is scheduled but vault holds no cron_secret, so nothing was called.';
    return null;
  end if;

  select value into v_base from public.app_config where key = 'site_base_url';
  if v_base is null then
    raise warning 'Payment reconciliation is scheduled but app_config has no site_base_url.';
    return null;
  end if;

  /* Fire and forget. pg_net queues the request and records the answer in
     net._http_response, so a slow or dead endpoint cannot hold a cron worker
     open. The timeout is generous because the sweep may walk up to forty
     payments and ask the hub about each one. */
  select net.http_get(
    url := rtrim(v_base, '/') || '/api/cron/reconcile-payments',
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_secret),
    timeout_milliseconds := 60000
  ) into v_request;

  return v_request;
end;
$function$;

revoke execute on function public.ring_payment_reconciliation() from public, anon, authenticated;
grant  execute on function public.ring_payment_reconciliation() to service_role;

-- ----------------------------------------------------------------------------
-- The clock.
--
-- Unscheduled first so this migration can be run again without ending up with
-- two jobs ringing the same bell, which would double every sweep.
-- ----------------------------------------------------------------------------
do $do$
begin
  if exists (select 1 from cron.job where jobname = 'reconcile-payments') then
    perform cron.unschedule('reconcile-payments');
  end if;
end;
$do$;

select cron.schedule(
  'reconcile-payments',
  '*/15 * * * *',
  $cron$select public.ring_payment_reconciliation()$cron$
);
