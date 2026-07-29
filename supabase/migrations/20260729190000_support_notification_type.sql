-- ---------------------------------------------------------------------------
-- A notification type for support replies
-- ---------------------------------------------------------------------------
--
-- ALONE IN ITS OWN MIGRATION, and it has to be: Postgres cannot use a new
-- enum label in the same transaction that adds it. The support tables and
-- functions in the next migration reference 'support', so the label must
-- already be committed by the time they run. Same split as 049/050, which
-- added and then used the `disputed` redemption status.
--
-- WHY NOT REUSE 'announcement'. The notification cards are coloured BY TYPE
-- (yellow announcement, green payout, red flag). A reply from a person you
-- asked for help is neither an announcement nor an alarm, and dressing it as
-- either teaches people to read the colour wrong on the two that matter.

alter type public.notification_type add value if not exists 'support';
