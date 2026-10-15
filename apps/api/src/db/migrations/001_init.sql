-- Core schema. Status columns use CHECK constraints instead of enums so migrations stay simple.

CREATE TABLE merchants (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                text NOT NULL,
  gateway_merchant_id text NOT NULL UNIQUE,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id   uuid NOT NULL REFERENCES merchants(id),
  email         text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  role          text NOT NULL CHECK (role IN ('ADMIN', 'VIEWER')),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX users_merchant_idx ON users (merchant_id);

-- Current state of each payment. Derived from processed events.
CREATE TABLE payments (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id        uuid NOT NULL REFERENCES merchants(id),
  gateway_payment_id text NOT NULL,
  amount_minor       bigint NOT NULL,
  currency           char(3) NOT NULL,
  status             text NOT NULL CHECK (status IN ('PENDING', 'SUCCEEDED', 'FAILED', 'REFUNDED')),
  version            int NOT NULL DEFAULT 0,
  last_event_at      timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (merchant_id, gateway_payment_id)
);
CREATE INDEX payments_merchant_status_created_idx ON payments (merchant_id, status, created_at);

-- Authoritative log of everything the gateway sent. The UNIQUE constraint is the deduplication point.
CREATE TABLE webhook_events (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gateway           text NOT NULL DEFAULT 'mock',
  gateway_event_id  text NOT NULL,
  merchant_id       uuid REFERENCES merchants(id),
  event_type        text NOT NULL,
  payload_hash      char(64) NOT NULL,
  payload           jsonb NOT NULL,
  status            text NOT NULL DEFAULT 'RECEIVED'
                    CHECK (status IN ('RECEIVED', 'PROCESSED', 'FAILED', 'REJECTED', 'DEAD')),
  attempt_count     int NOT NULL DEFAULT 0,
  attempt_base      int NOT NULL DEFAULT 0,   -- attempts before the last admin force-retry
  last_error        text,
  next_attempt_at   timestamptz,
  received_at       timestamptz NOT NULL DEFAULT now(),
  processed_at      timestamptz,
  UNIQUE (gateway, gateway_event_id)
);
CREATE INDEX webhook_events_status_next_idx ON webhook_events (status, next_attempt_at);
CREATE INDEX webhook_events_merchant_received_idx ON webhook_events (merchant_id, received_at);

CREATE TABLE webhook_event_attempts (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  webhook_event_id uuid NOT NULL REFERENCES webhook_events(id) ON DELETE CASCADE,
  attempt_no       int NOT NULL,
  outcome          text NOT NULL CHECK (outcome IN ('SUCCEEDED', 'FAILED')),
  error            text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (webhook_event_id, attempt_no)
);

-- Append-only history of every change made by a person or the system.
CREATE TABLE audit_logs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL REFERENCES merchants(id),
  actor       text NOT NULL,
  action      text NOT NULL,
  entity_type text NOT NULL,
  entity_id   text NOT NULL,
  before      jsonb,
  after       jsonb,
  request_id  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_merchant_created_idx ON audit_logs (merchant_id, created_at);
CREATE INDEX audit_logs_entity_idx ON audit_logs (entity_type, entity_id);
