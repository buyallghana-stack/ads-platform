-- Paying for a plan by sending mobile money by hand.
--
-- Operator direction 2026-09-28: Paystack is switched off (the fees), and a
-- buyer instead sends the price to a number the operator publishes, then says
-- so. The operator checks their phone and confirms or rejects in the admin.
--
-- NO SECOND MONEY PATH. A manual payment is an ordinary `subscription_payments`
-- row opened by `start_subscription_payment` (so the band, the coupon and every
-- refusal are the same), and it is granted by `confirm_subscription_payment`,
-- the function the hub uses. Only who says "the money arrived" differs.
--
-- It carries NO `external_reference`, which is what keeps the reconciliation
-- sweep (it only asks the hub about rows that have one) from closing it.

alter type public.subscription_payment_method add value if not exists 'manual';

alter table public.subscription_payments
  -- A short code for this payment (P-XXXXXX) that the buyer and the operator
  -- can both quote. Also what marks the row as a manual payment.
  add column if not exists manual_reference     text unique,
  add column if not exists manual_sender_phone  text,
  add column if not exists manual_sender_name   text,
  -- The buyer's screenshot of the transfer, in the private `payment-proofs`
  -- bucket, compressed in the browser before upload.
  add column if not exists manual_proof_path    text,
  -- Set when the buyer presses "I have sent it"; until then nobody is waiting.
  add column if not exists manual_claimed_at    timestamptz;

create index if not exists subscription_payments_manual_waiting_idx
  on public.subscription_payments (manual_claimed_at)
  where manual_reference is not null and status = 'pending';

insert into public.app_config
  (key, value, value_type, min_value, max_value, is_public, description)
values
  ('paystack_checkout_enabled', 'false', 'bool', null, null, false,
   'Offer Paystack (card and mobile money through the Tech Store) at checkout. Off hides it and refuses it.'),
  ('manual_payment_enabled', 'true', 'bool', null, null, false,
   'Offer paying for a plan by sending mobile money by hand to the number below. It only shows once a number is set.'),
  ('manual_payment_number', '', 'text', null, null, false,
   'The mobile money number buyers send plan payments to.'),
  ('manual_payment_account_name', '', 'text', null, null, false,
   'The name registered on that number, shown so buyers can check they are sending to the right person.'),
  ('manual_payment_network', '', 'text', null, null, false,
   'The network of that number, for example MTN MoMo.'),
  ('payment_alert_phones', '0548076680', 'text', null, null, false,
   'Phone numbers texted when a buyer says they have sent a manual payment, separated by commas. Leave empty to stop the texts.')
on conflict (key) do nothing;

-- Screenshots of transfers. PRIVATE: they show a phone number, a name and an
-- amount. Written and read only by the server with the service key (no
-- policies for anyone else), and the admin sees them through signed links.
-- 1 MB is far above what the browser sends (about 150 to 300 KB) and below the
-- server action's own 1 MB body limit.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('payment-proofs', 'payment-proofs', false, 1048576,
        array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
