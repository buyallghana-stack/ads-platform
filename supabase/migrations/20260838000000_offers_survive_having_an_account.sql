-- ============================================================================
-- Migration 190 — the programmes are offered to anybody who holds none
--
-- Operator, 2026-08-12, with three screenshots: the dashboard "was supposed to
-- show the two programs", the account screen "shows only 1", and "continue
-- training when clicked shows no course at the learn tab".
--
-- All three are the same hole, and the reset is what walked into it. Until
-- today every account with an affiliate row had bought training, so "you have
-- an account" and "you own a course" were the same fact. They are not any
-- more, and three screens were built on the assumption.
--
-- ── 1. THE OFFERS DISAPPEARED THE MOMENT AN ACCOUNT EXISTED ──
--
-- `affiliate_dashboard_core` built `training_offers` ONLY in its
-- `if not found` branch — no affiliate row, here are the programmes. Once a
-- row existed the payload never carried them again, on the reasoning that
-- anybody with an account had already joined. So a pending account with
-- nothing bought got the "Almost there, finish your training" panel and no way
-- to buy any. The offers are now built whenever the person holds NO active
-- training entitlement, whether or not they have an account row.
--
-- ── 2. A FIRST PURCHASE IS NOT AN UPGRADE ──
--
-- `training_upgrade_offer` asks for the cheapest programme ABOVE what somebody
-- holds, and `owned_training_rank` is 0 when they hold nothing — so 1 > 0 and
-- Beginner came back as an "upgrade". The account screen then rendered the
-- upgrade panel at somebody who owns nothing: "Move up a level", "picks up
-- where your current training stops", "you keep everything you have already
-- bought". Every word of that is wrong for a first purchase, and it is the
-- "profile shows only 1" in the operator's message — one programme, framed as
-- an upgrade, instead of two offered plainly.
--
-- It returns NULL at rank 0 now. `start_training_upgrade` already refuses that
-- case ("You have no training to upgrade from"), so the offer and the charge
-- finally agree about what an upgrade is.
--
-- The third symptom — "Continue your training" leading to an empty Learn tab —
-- is fixed in the screen rather than here: `LinksLocked` knows the difference
-- between no training and unfinished training, because `percent` is null in
-- the first case and a number in the second.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- One place that answers "what could this person buy?"
-- ---------------------------------------------------------------------------
--
-- Extracted from the branch it was trapped in, so both callers ask the same
-- question and a published programme cannot be visible on one screen and
-- missing from another.

create or replace function public.training_offers_json()
returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce((
    select jsonb_agg(jsonb_build_object(
             'product_id',   pr.id,
             'slug',         pr.slug,
             'title',        pr.title,
             'description',  pr.description,
             'cover_path',   pr.cover_path,
             'level',        tp.level::text,
             'depth',        tp.commission_depth,
             'price_minor',  public.product_price_minor(pr.id),
             'list_price_minor', pr.price_minor,
             'validity_days',    tp.validity_days,
             'grace_days',       tp.grace_days,
             'renewal_price_minor', tp.renewal_price_minor,
             'threshold',    tp.activation_threshold_percent,
             'certificate',  tp.certificate_enabled,
             'lessons',      (select count(*)
                                from public.lessons l
                                join public.course_sections s on s.id = l.section_id
                               where s.product_id = pr.id)
           ) order by pr.price_minor)
      from public.training_programs tp
      join public.products pr on pr.id = tp.product_id
     where pr.status = 'published'
  ), '[]'::jsonb);
$$;

revoke execute on function public.training_offers_json() from public, anon;
grant execute on function public.training_offers_json() to authenticated, service_role;


-- ---------------------------------------------------------------------------
-- An upgrade needs something to upgrade from
-- ---------------------------------------------------------------------------
--
-- ⚠️ RESTATED FROM THE LIVE DEFINITION with one clause added. The body is
-- migration 186's, which itself was restated from live after I rebuilt a
-- function from its original and lost a branch (migration 180).

create or replace function public.training_upgrade_offer(p_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
           'product_id', pr.id, 'slug', pr.slug, 'title', pr.title,
           'description', pr.description, 'level', tp.level::text,
           'price_minor', public.product_price_minor(pr.id),
           'upgrade_minor', greatest(
              public.product_price_minor(pr.id)
                - coalesce((select max(o.amount_minor)
                              from public.affiliate_entitlements ae
                              join public.orders o on o.id = ae.order_id
                              join public.affiliate_accounts a on a.id = ae.affiliate_id
                             where a.user_id = p_user_id and ae.status = 'active'), 0),
              0),
           'lessons', (select count(*)::int from public.lessons l
                         join public.course_sections s on s.id = l.section_id
                        where s.product_id = pr.id),
           'depth', tp.commission_depth,
           'validity_days', tp.validity_days,
           'certificate', tp.certificate_enabled
         )
    from public.training_programs tp
    join public.products pr on pr.id = tp.product_id
   where pr.status = 'published'
     and public.training_level_rank(tp.level::text) > public.owned_training_rank(p_user_id)
     /* ⚠️ NOTHING HELD IS NOT AN UPGRADE. Rank 0 means they own no training at
        all, and 1 > 0 made Beginner an "upgrade" for somebody who had bought
        nothing — which the account screen then described as picking up where
        their current training stops. `start_training_upgrade` has always
        refused that case; now the offer agrees with it. */
     and public.owned_training_rank(p_user_id) > 0
   order by public.training_level_rank(tp.level::text)
   limit 1;
$$;


-- ---------------------------------------------------------------------------
-- The dashboard payload, restated from the LIVE definition
-- ---------------------------------------------------------------------------
--
-- ⚠️ `pg_get_functiondef` first. Two changes only: the no-account branch calls
-- the shared list, and the main return carries it whenever the person holds no
-- training.

CREATE OR REPLACE FUNCTION public.affiliate_dashboard_core(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_aff      public.affiliate_accounts;
  v_ent      record;
  v_state    text;
  v_balance  bigint := 0;
  v_pending  bigint := 0;
  v_earned   bigint := 0;
  v_reversed bigint := 0;
  v_paid     bigint := 0;
  v_clicks   int := 0;
  v_convs    int := 0;
  v_train    jsonb := '[]'::jsonb;
begin
  select * into v_aff
    from public.affiliate_accounts
   where user_id = p_user_id;

  if not found then
    return jsonb_build_object(
      'state', 'none',
      /* The same list the shared function gives everybody who owns nothing.
         It used to be spelled out here, which is exactly why it stopped being
         offered the moment an account row existed (migration 190). */
      'training_offers', public.training_offers_json()
    );
  end if;

  select e.commission_depth, e.expires_at, e.grace_ends_at, e.status,
         tp.level::text as level,
         greatest(0, floor(extract(epoch from (e.expires_at - now())) / 86400)::int) as days_left
    into v_ent
    from public.affiliate_entitlements e
    join public.training_programs tp on tp.id = e.training_program_id
   where e.affiliate_id = v_aff.id
     and e.status = 'active'
     and e.grace_ends_at > now()
   order by e.grace_ends_at desc
   limit 1;

  v_state := case
               when v_aff.status = 'suspended' then 'suspended'
               when v_aff.status = 'pending'   then 'pending'
               when v_ent.level is null        then 'lapsed'
               else 'active'
             end;

  v_balance := public.affiliate_balance_minor(v_aff.id);
  v_pending := public.affiliate_pending_minor(v_aff.id);

  /* Split by MEANING, not by entry type (migration 132): earned counts credits
     plus adjustments in the affiliate's favour, so the three sum to the
     balance and the screen is internally consistent. */
  select coalesce(sum(amount_minor) filter (
           where entry_type = 'credit'
              or (entry_type = 'adjustment' and amount_minor > 0)), 0),
         coalesce(sum(amount_minor) filter (
           where entry_type = 'reversal'
              or (entry_type = 'adjustment' and amount_minor < 0)), 0),
         coalesce(sum(amount_minor) filter (where entry_type = 'payout'), 0)
    into v_earned, v_reversed, v_paid
    from public.commission_ledger
   where affiliate_id = v_aff.id
     and status <> 'reversed';

  select count(*) into v_clicks
    from public.affiliate_clicks
   where affiliate_id = v_aff.id
     and created_at > now() - interval '30 days';

  select count(*) into v_convs
    from public.conversions
   where (affiliate_id = v_aff.id or l2_affiliate_id = v_aff.id)
     and status = 'attributed'
     and created_at > now() - interval '30 days';

  /* The entitled programs, with the fields the dashboard card needs. */
  select coalesce(jsonb_agg(x order by x->>'title'), '[]'::jsonb) into v_train
    from (
      select jsonb_build_object(
               'product_id',  pr.id,
               'slug',        pr.slug,
               'title',       pr.title,
               'level',       tp.level::text,
               'percent',     public.training_completion_percent(p_user_id, pr.id),
               'threshold',   tp.activation_threshold_percent,
               'certificate', tp.certificate_enabled
             ) as x
        from public.affiliate_entitlements e
        join public.training_programs tp on tp.id = e.training_program_id
        join public.products pr on pr.id = tp.product_id
       where e.affiliate_id = v_aff.id
    ) s;

  return jsonb_build_object(
    'state',          v_state,
    'affiliate_id',   v_aff.id,
    'code',           v_aff.affiliate_code,
    'depth',          public.affiliate_depth_now(v_aff.id),
    'tier',           v_ent.level,
    'expires_at',     v_ent.expires_at,
    'grace_ends_at',  v_ent.grace_ends_at,
    'days_left',      v_ent.days_left,
    'balance_minor',  v_balance,
    'pending_minor',  v_pending,
    'earned_minor',   v_earned,
    'reversed_minor', -v_reversed,
    'paid_minor',     -v_paid,
    'clicks_30d',     v_clicks,
    'conversions_30d', v_convs,
    'training',       v_train,
    /* ⚠️ OFFERED TO ANYBODY WHO HOLDS NONE, account row or not. Before
       migration 190 this key existed only on the "no account" branch, so a
       pending account with nothing bought was told to finish training it had
       never bought and given no way to buy any. Empty once they hold
       something, so a member who owns a course is not sold it again. */
    'training_offers', case when v_train = '[]'::jsonb
                            then public.training_offers_json()
                            else '[]'::jsonb end,
    'payouts_enabled', coalesce((select value = 'true' from public.app_config
                                  where key = 'affiliate_payouts_enabled'), false),
    'payout_minimum_minor', coalesce((select value::bigint from public.app_config
                                       where key = 'commission_payout_minimum_minor'), 0)
  );
end;
$function$;
