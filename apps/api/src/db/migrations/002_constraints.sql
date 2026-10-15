-- Rules that must hold even if application code has a bug.
ALTER TABLE payments ADD CONSTRAINT payment_amount_nonnegative CHECK (amount_minor >= 0);
ALTER TABLE payments ADD CONSTRAINT payment_currency_format CHECK (currency::text ~ '^[A-Z]{3}$');
ALTER TABLE webhook_events ADD CONSTRAINT webhook_event_attempt_count_nonnegative CHECK (attempt_count >= 0);
