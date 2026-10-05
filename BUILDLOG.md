# Build Log

This document tracks AI assistance during development.

## AI Usage Log

| Date | Task | AI Help | Was AI Wrong? | What I Changed |
|------|------|---------|---------------|----------------|
| 2026-10-05 | Project scaffolding (package.json, tsconfig, docker-compose) | Generated initial config files | No | Minor adjustments to scripts |
| 2026-10-05 | Database schema design | Designed tables and indexes | No | Added processed_webhook_events table |
| 2026-10-05 | Idempotency key implementation | Designed hash-based deduplication | No | Added request hash validation |
| 2026-10-05 | AI token pricing logic | Implemented pricing rules per spec | No | Verified math with test cases |
| 2026-10-05 | Stripe webhook handling | Implemented signature verification + deduplication | No | Added event type handling |
| 2026-10-05 | Quota enforcement | Designed pre-check logic with 429/402 | No | Added Retry-After header |

## Key Decisions

1. **Integer cents for money** - All monetary values stored as integer cents to avoid floating-point errors
2. **SHA256 for idempotency keys** - Keys hashed before storage, request body hashed for validation
3. **Separate idempotency_keys table** - Cleaner than storing in usage_events, supports TTL cleanup
4. **Pre-check quota** - Quota verified before inserting usage event to prevent overages
5. **Processed webhook events table** - Deduplicates Stripe webhook events by stripe_event_id
6. **Background cleanup job** - Hourly cleanup of expired idempotency keys

## Issues Encountered & Resolved

- **PowerShell mkdir syntax** - Used comma-separated directories instead of brace expansion
- **Stripe webhook raw body** - Used express.raw() middleware only for webhook route
- **TypeScript ES modules** - Added .js extensions to imports, used NodeNext module resolution

## Testing Performed

*To be filled as testing progresses*