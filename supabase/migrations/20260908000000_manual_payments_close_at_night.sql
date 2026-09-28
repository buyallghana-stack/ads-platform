-- Manual mobile money closes at night.
--
-- Operator direction 2026-09-28: deposits by hand close at 10pm, unless the
-- buyer can pay in full from their points. The operator confirms every manual
-- payment by hand, so one started when nobody is awake to check it just waits.
-- Operator: open at 8am, close at 10pm. Both are settings.
-- Hours are Ghana time (GMT, no daylight saving). A payment started before
-- closing can still be marked as sent.

insert into public.app_config
  (key, value, value_type, min_value, max_value, is_public, description)
values
  ('manual_payment_close_hour', '22', 'int', 0, 23, false,
   'Hour (0 to 23, Ghana time) when paying by mobile money by hand closes for the night. Paying in full from the balance stays open.'),
  ('manual_payment_open_hour', '8', 'int', 0, 23, false,
   'Hour (0 to 23, Ghana time) when paying by mobile money by hand opens again in the morning. Set it equal to the closing hour to never close.')
on conflict (key) do nothing;
