-- Reference only: bootstrap applies this additive change.
ALTER TABLE users ADD COLUMN IF NOT EXISTS telegram_reminder_attempted_at TIMESTAMPTZ;
