# ADR 001: Idempotent processing with PostgreSQL, not Redis or a broker

**Status:** Accepted

## Context
Payment gateways deliver webhooks at least once and may reorder them. We must apply each event exactly once.

## Decision
Deduplicate with a UNIQUE constraint on (gateway, gateway_event_id). Process each event in its own transaction with a conditional claim. Keep the receipt and the processing in separate transactions so failures leave a record.

## Alternatives rejected
- In-memory set: lost on restart, not shared across instances.
- Redis check-then-write: race between check and write; Redis is not the source of truth.
- Message broker: adds a second system whose failures must be handled, with no correctness gain for a single-database write path.

## Consequences
- Correctness is provable with tests against the real database.
- Processing must write only to PostgreSQL. Side effects to external systems need a transactional outbox (not built).
