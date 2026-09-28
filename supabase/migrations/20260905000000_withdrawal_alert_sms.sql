-- Texting the operator when a withdrawal is requested.
--
-- Operator direction 2026-09-28: every payout request sends an SMS, by default
-- to 0548076680, and the number is admin-configurable. Several numbers may be
-- listed, separated by commas; an empty value switches the alert off.

insert into public.app_config
  (key, value, value_type, min_value, max_value, is_public, description)
values
  ('withdrawal_alert_phones', '0548076680', 'text', null, null, false,
   'Phone numbers texted whenever a member requests a withdrawal, separated by commas. Leave empty to stop the texts.')
on conflict (key) do nothing;
