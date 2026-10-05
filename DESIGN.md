# Design Document: Usage Metering & Billing Engine

## Problem Statement
Build a backend service that meters usage (API calls + AI tokens), enforces subscription quotas, calculates costs with correct AI token pricing rules, and integrates with Stripe for subscription management — all with idempotency guarantees and correct money math.

## Data Model

### Tenants
```sql
CREATE TABLE tenants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    stripe_customer_id VARCHAR(255) UNIQUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Plans
```sql
CREATE TABLE plans (
    id VARCHAR(50) PRIMARY KEY,  -- 'free', 'pro'
    name VARCHAR(100) NOT NULL,
    api_calls_limit INTEGER NOT NULL,
    ai_tokens_limit INTEGER NOT NULL,
    price_cents INTEGER NOT NULL DEFAULT 0,  -- monthly price in cents
    stripe_price_id VARCHAR(255),  -- Stripe Price ID for Pro plan
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed data:
-- free: 1000 API calls, 100000 AI tokens, $0
-- pro:  10000 API calls, 1000000 AI tokens, $4900 ($49/month)
```

### Subscriptions
```sql
CREATE TABLE subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    plan_id VARCHAR(50) NOT NULL REFERENCES plans(id),
    stripe_subscription_id VARCHAR(255) UNIQUE,
    status VARCHAR(50) NOT NULL,  -- 'active', 'canceled', 'past_due', 'trialing'
    current_period_start TIMESTAMPTZ NOT NULL,
    current_period_end TIMESTAMPTZ NOT NULL,
    cancel_at_period_end BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Usage Events
```sql
CREATE TABLE usage_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    event_type VARCHAR(50) NOT NULL,  -- 'api_call', 'ai_tokens'
    quantity INTEGER NOT NULL,
    idempotency_key VARCHAR(255) NOT NULL,
    metadata JSONB DEFAULT '{}',  -- token breakdown: input, cached_input, output, reasoning
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (tenant_id, idempotency_key)
);

CREATE INDEX idx_usage_events_tenant_created ON usage_events(tenant_id, created_at);
CREATE INDEX idx_usage_events_idempotency ON usage_events(tenant_id, idempotency_key);
```

### Idempotency Keys (separate table for cleaner deduplication)
```sql
CREATE TABLE idempotency_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    key_hash VARCHAR(64) NOT NULL,  -- SHA256 of the provided key
    request_hash VARCHAR(64) NOT NULL,  -- SHA256 of request body for validation
    response_status INTEGER,
    response_body JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    UNIQUE (tenant_id, key_hash)
);

CREATE INDEX idx_idempotency_expires ON idempotency_keys(expires_at);
```

## API Contract

### POST /api/v1/meter
Record a usage event (idempotent).

**Headers:**
- `X-Tenant-ID`: UUID (required)
- `Idempotency-Key`: string (required, max 255 chars)

**Body:**
```json
{
  "type": "api_call" | "ai_tokens",
  "quantity": 1,
  "metadata": {
    "input_tokens": 1000,
    "cached_input_tokens": 100,
    "output_tokens": 500,
    "reasoning_tokens": 50
  }
}
```

**Responses:**
- `200 OK` - Usage recorded (or duplicate detected, returns original response)
- `400 Bad Request` - Invalid payload
- `401 Unauthorized` - Invalid tenant
- `402 Payment Required` - Subscription inactive/past_due
- `429 Too Many Requests` - Quota exceeded

### GET /api/v1/usage
Get current month's usage rollup for tenant.

**Headers:**
- `X-Tenant-ID`: UUID (required)

**Response:**
```json
{
  "period_start": "2026-10-01T00:00:00Z",
  "period_end": "2026-10-31T23:59:59Z",
  "plan": "free",
  "api_calls": { "used": 150, "limit": 1000, "cost_cents": 0 },
  "ai_tokens": { "used": 25000, "limit": 100000, "cost_cents": 125 },
  "total_cost_cents": 125
}
```

### POST /api/v1/checkout
Create Stripe Checkout session for Pro upgrade.

**Headers:**
- `X-Tenant-ID`: UUID (required)

**Response:**
```json
{
  "checkout_url": "https://checkout.stripe.com/pay/cs_test_..."
}
```

### POST /webhooks/stripe
Stripe webhook endpoint (signature verified).

**Events handled:**
- `checkout.session.completed` - Activate Pro subscription
- `customer.subscription.updated` - Sync plan/status changes
- `customer.subscription.deleted` - Revert to Free plan

## Idempotency Strategy

1. Client generates a unique idempotency key per billable action (UUID v4 recommended)
2. Server hashes the key (SHA256) + hashes request body for validation
3. On first request: process, store response, return 200
4. On retry with same key: 
   - If request hash matches → return stored response (200)
   - If request hash differs → 409 Conflict (key reuse with different payload)
5. Keys expire after 24 hours (cleanup job)

## Quota Enforcement Logic

```
current_usage = rollup(usage_events for current billing period)
requested_usage = quantity from request

if current_usage + requested_usage > plan_limit:
    if subscription.status != 'active':
        return 402 { error: "Subscription inactive. Upgrade to continue." }
    else:
        return 429 { error: "Monthly quota exceeded. Resets on <period_end>.", retry_after: seconds_until_reset }
else:
    allow request
```

## AI Token Pricing Rules

Pricing constants (pinned in config):
```
INPUT_TOKEN_PRICE_PER_M = 150      // $0.15 per 1M input tokens
CACHED_INPUT_TOKEN_PRICE_PER_M = 37.5  // $0.0375 per 1M cached input (75% discount)
OUTPUT_TOKEN_PRICE_PER_M = 600     // $0.60 per 1M output tokens
REASONING_TOKEN_PRICE_PER_M = 600  // $0.60 per 1M reasoning tokens (billed as output)
```

Calculation:
```
cost = 
  (input_tokens - cached_input_tokens) * INPUT_TOKEN_PRICE_PER_M / 1_000_000 +
  cached_input_tokens * CACHED_INPUT_TOKEN_PRICE_PER_M / 1_000_000 +
  (output_tokens + reasoning_tokens) * OUTPUT_TOKEN_PRICE_PER_M / 1_000_000
```

All money stored as integer cents (micro-units for sub-cent precision).

## Stripe Integration

- Test mode only (no credit card needed)
- Test card: 4242 4242 4242 4242
- Webhook secret stored in `.env` (git-ignored)
- Stripe CLI for local webhook forwarding: `stripe listen --forward-to localhost:3000/webhooks/stripe`
- Event deduplication via `stripe_event_id` tracking table

## Non-Goals (Explicit)
- No proration handling (stretch goal)
- No invoicing/PDF generation (stretch goal)
- No real AI model calls - token counts are simulated
- No multi-currency support
- No usage alerts/notifications (stretch goal)
- No overage billing (stretch goal)