-- ============================================================================
-- Migration 229 — the hub payments an admin can see
--
-- Part B records everything and shows none of it. When the hub reports an
-- amount that disagrees with the order, `applyHubEvent` refuses to grant the
-- plan, writes `mismatch` into `hub_inbound_events`, and answers 2xx so the
-- hub stops retrying. All correct, and completely invisible: finding it means
-- somebody with database access writing a query.
--
-- Two reads, because an admin has two different questions.
--
--   admin_list_hub_payments  what did somebody buy, and did it complete
--   admin_list_hub_flags     what arrived that we did NOT act on
--
-- The second is the one that matters. A flagged event is money that moved at
-- the provider and did not move here, and nothing else in the app will ever
-- mention it.
--
-- Both follow the convention `admin_list_redemptions` set: SECURITY DEFINER so
-- they can read across users, with an `is_admin()` re-check for any non-null
-- caller, so a browser token answers to the same predicate that guards every
-- other admin table and no service key is needed to render a page.
-- ============================================================================

create or replace function public.admin_list_hub_payments(p_limit integer default 100)
returns table (
  id              uuid,
  user_id         uuid,
  person          text,
  email           text,
  tier_name       text,
  amount_minor    bigint,
  currency_code   character(3),
  status          public.subscription_payment_status,
  hub_reference   text,
  failure_reason  text,
  created_at      timestamptz,
  confirmed_at    timestamptz,
  last_event      text,
  last_result     text,
  last_detail     text,
  last_event_at   timestamptz,
  event_count     integer
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if (select auth.uid()) is not null and not public.is_admin() then
    raise exception 'Not an administrator' using errcode = 'insufficient_privilege';
  end if;

  return query
  select
    sp.id,
    sp.user_id,
    pr.full_name,
    u.email::text,
    t.name,
    sp.amount_minor,
    sp.currency_code,
    sp.status,
    sp.external_reference,
    sp.failure_reason,
    sp.created_at,
    sp.confirmed_at,
    /* The newest event for this payment, which is what an admin wants first:
       not the whole history, the last thing that happened to it. */
    last_event.event,
    last_event.result,
    last_event.detail,
    last_event.received_at,
    coalesce(counted.n, 0)::int
  from public.subscription_payments sp
  join public.tiers t     on t.id = sp.tier_id
  left join public.profiles pr on pr.id = sp.user_id
  left join auth.users u       on u.id = sp.user_id
  left join lateral (
    select e.event, e.result, e.detail, e.received_at
      from public.hub_inbound_events e
     where e.payment_id = sp.id
     order by e.received_at desc
     limit 1
  ) last_event on true
  left join lateral (
    select count(*) as n from public.hub_inbound_events e where e.payment_id = sp.id
  ) counted on true
  /* Hub payments only. A row with no reference never reached the hub, and the
     older Paystack-direct rows are not this screen's subject. */
  where sp.external_reference is not null
  order by sp.created_at desc
  limit greatest(1, least(coalesce(p_limit, 100), 500));
end;
$function$;

revoke execute on function public.admin_list_hub_payments(integer) from public, anon;
grant  execute on function public.admin_list_hub_payments(integer) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- What arrived that we did not act on.
--
-- `confirmed`, `failed`, `reversed` and `already_done` are the hub and this app
-- agreeing. Everything else is a question somebody has to answer:
--
--   mismatch           the hub's amount disagreed with the order, nothing granted
--   unknown_reference  a reference this app has never held
--   error              our side could not apply it, and the hub is retrying
--   received           recorded and then nothing, which means a crash mid-flight
--
-- `received` is the interesting one. The row is written before the work and
-- updated after, so a row still saying `received` is one where the process
-- died in between.
-- ----------------------------------------------------------------------------
create or replace function public.admin_list_hub_flags(p_limit integer default 100)
returns table (
  id            uuid,
  request_id    uuid,
  event         text,
  hub_reference text,
  amount_minor  bigint,
  currency_code character(3),
  result        text,
  detail        text,
  received_at   timestamptz,
  payment_id    uuid,
  person        text
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if (select auth.uid()) is not null and not public.is_admin() then
    raise exception 'Not an administrator' using errcode = 'insufficient_privilege';
  end if;

  return query
  select
    e.id, e.request_id, e.event, e.hub_reference, e.amount_minor, e.currency_code,
    e.result, e.detail, e.received_at, e.payment_id, pr.full_name
  from public.hub_inbound_events e
  left join public.subscription_payments sp on sp.id = e.payment_id
  left join public.profiles pr on pr.id = sp.user_id
  where e.result not in ('confirmed', 'failed', 'reversed', 'already_done')
  order by e.received_at desc
  limit greatest(1, least(coalesce(p_limit, 100), 500));
end;
$function$;

revoke execute on function public.admin_list_hub_flags(integer) from public, anon;
grant  execute on function public.admin_list_hub_flags(integer) to authenticated, service_role;
