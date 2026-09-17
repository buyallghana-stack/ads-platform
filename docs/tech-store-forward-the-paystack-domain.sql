-- Tell SidePerks which Paystack the money came from.
--
-- This account was in TEST mode in production from the beginning. Neither app
-- could see it: a test secret key produces webhooks and signatures
-- indistinguishable from live ones, and the key cannot be read back out of a
-- deployment. Sixteen SidePerks intents were opened on it, six reported
-- successful, and one of those granted a real plan on their side. No money
-- moved for any of them.
--
-- Nothing malfunctioned. This hub reported what Paystack told it and SidePerks
-- believed the hub, and both were right to. What was missing was anyone asking
-- WHICH Paystack.
--
-- Paystack stamps `domain` on every transaction object it returns and this
-- database has stored the whole object all along, so the answer has been one
-- column away the entire time. It never left this table. SidePerks reads the
-- field already (their `decide.ts`, 17 September 2026) and refuses to grant a
-- plan against test money; until this migration there was nothing to read.
--
-- ⚠️ THE TRAP, AND IT IS THE WHOLE REASON THIS IS NOT A ONE WORD CHANGE.
-- `v_intent` is the snapshot taken by the `select ... for update` at the top,
-- BEFORE the update below. On a first settle its `paystack_payload` is still
-- null, and the fresh object is the `p_payload` argument. A notification built
-- from `v_intent.paystack_payload` would therefore carry `domain: null` on
-- every real payment, the guard on the other side would never fire, and the
-- whole exercise would look finished while changing nothing.
--
-- The line above it already solves this for `paid_at`, with
-- `coalesce(v_intent.paid_at, v_now)`. `domain` mirrors the update the same
-- way: `coalesce(p_payload, v_intent.paystack_payload)`, which is exactly what
-- the update writes to the column.
--
-- ⚠️ AND THE SIGNATURE MUST MATCH TO THE ARGUMENT, not to the intention.
-- `create or replace function` matches on the argument list, so a version of
-- this written from memory with `text` where the enums are, or with the
-- arguments in a friendlier order, creates a SECOND overload beside the first
-- and leaves the live one untouched. The header below is copied from
-- 20260916072531 rather than retyped, for that reason.
--
-- Nothing else changes. This adds a field to the signed BODY, which the
-- signature covers like any other byte, so the signing string is untouched.
-- SidePerks treats an absent or unrecognised `domain` as `unknown` and fulfils
-- normally, so the six notifications already queued under the old shape are
-- unaffected.

create or replace function public.hub_settle_intent(
  p_reference        text,
  p_status           public.hub_intent_status,
  p_amount_pesewas   bigint,
  p_payload          jsonb,
  p_event            public.hub_outbound_event
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_intent public.payment_intents;
  v_now    timestamptz := now();
begin
  -- Locked, so two deliveries of the same charge queue behind each other
  -- rather than both deciding they were first.
  select * into v_intent
  from public.payment_intents
  where reference = p_reference and source_app = 'sideperks'
  for update;

  if not found then
    -- Not ours. The caller falls through to the Tech Store's own handling,
    -- which is the ordinary case for every real order in this shop.
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  -- The amount is checked here as well as in the caller. A payment that
  -- succeeded for a different figure than was asked for is not a payment, it
  -- is an incident, and nothing downstream may be told it was fulfilled.
  if p_status = 'success' and p_amount_pesewas is distinct from v_intent.amount_pesewas then
    return jsonb_build_object(
      'ok', false,
      'reason', 'amount_mismatch',
      'expected', v_intent.amount_pesewas,
      'received', p_amount_pesewas,
      'intent_id', v_intent.id
    );
  end if;

  if v_intent.status = p_status then
    return jsonb_build_object(
      'ok', true, 'changed', false, 'intent_id', v_intent.id,
      'external_ref', v_intent.external_ref
    );
  end if;

  -- A reversal may follow a success. A success may never follow a reversal:
  -- that ordering only happens when events arrive out of order, and the later
  -- truth is the refund.
  if v_intent.status = 'reversed' and p_status <> 'reversed' then
    return jsonb_build_object('ok', false, 'reason', 'already_reversed', 'intent_id', v_intent.id);
  end if;

  update public.payment_intents
     set status           = p_status,
         paid_at          = case when p_status = 'success' then coalesce(v_intent.paid_at, v_now)
                                 else v_intent.paid_at end,
         reversed_at      = case when p_status = 'reversed' then v_now else v_intent.reversed_at end,
         paystack_payload = coalesce(p_payload, v_intent.paystack_payload),
         last_verified_at = v_now
   where id = v_intent.id;

  -- on conflict do nothing, because the unique on (intent, event) is what
  -- makes a duplicate delivery harmless rather than an error to handle.
  insert into public.outbound_notifications (payment_intent_id, event, payload)
  values (
    v_intent.id,
    p_event,
    jsonb_build_object(
      'event', p_event,
      'reference', v_intent.reference,
      'external_ref', v_intent.external_ref,
      'amount_minor', v_intent.amount_pesewas,
      'currency', v_intent.currency,
      'paid_at', to_char(coalesce(v_intent.paid_at, v_now) at time zone 'utc',
                         'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      /* The same expression the update above writes to the column, never the
         stale snapshot. See the header. A failed intent has no transaction
         object at all, so this is null there, and null reads as `unknown` on
         the other side, which is correct: a failure grants nothing either
         way. */
      'domain', coalesce(p_payload, v_intent.paystack_payload) ->> 'domain'
    )
  )
  on conflict (payment_intent_id, event) do nothing;

  return jsonb_build_object(
    'ok', true, 'changed', true, 'intent_id', v_intent.id,
    'external_ref', v_intent.external_ref, 'status', p_status
  );
end;
$$;

-- Repeated from the original. `create or replace` keeps existing privileges,
-- so this is belt rather than braces, and it costs one line to be sure that a
-- function reachable with the anon key never becomes one by accident.
revoke execute on function public.hub_settle_intent(text, public.hub_intent_status, bigint, jsonb, public.hub_outbound_event)
  from public, anon, authenticated;
