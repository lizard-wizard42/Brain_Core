-- Operator-controlled rollback: removes queue ordering metadata.
ALTER TABLE users DROP COLUMN IF EXISTS telegram_reminder_attempted_at;
