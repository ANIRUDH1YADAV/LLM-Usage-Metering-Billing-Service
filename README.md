# Usage Metering & Billing Engine

A production-ready backend service for metering usage, enforcing quotas, calculating costs with correct AI token pricing, and integrating with Stripe for subscription management.

## Features

- **Idempotent Usage Metering** - Exactly-once recording via idempotency keys
- **Quota Enforcement** - Real-time quota checks with proper 429/402 responses
- **AI Token Pricing** - Correct handling of cached input tokens, reasoning tokens, and output tokens
- **Stripe Integration** - Checkout flow + webhook handling with signature verification
- **Multi-tenant** - Complete data isolation per tenant

## Architecture

```
┌─────────────┐     ┌──────────────┐     ┌─────────────────┐
│   Client    │────▶│  API Layer   │────▶│  Meter Service  │
└─────────────┘     │  (Express)   │     │  (Idempotent)   │
                    └──────────────┘     └────────┬────────┘
                           │                      │
                    ┌──────▼──────┐     ┌─────────▼────────┐
                    │  Quota      │     │  Usage Events    │
                    │  Enforcement│     │  (PostgreSQL)    │
                    └──────┬──────┘     └──────────────────┘
                           │
                    ┌──────▼──────┐     ┌──────────────────┐
                    │  Stripe     │     │  Cost Calculation│
                    │  Webhooks   │     │  (Pricing Rules) │
                    └─────────────┘     └──────────────────┘
```

## Quick Start

### Prerequisites
- Node.js 20+
- Docker (for PostgreSQL)
- Stripe CLI (for webhook testing)

### Setup

1. **Clone and install dependencies**
```bash
npm install
```

2. **Start PostgreSQL**
```bash
npm run db:up
```

3. **Configure environment**
```bash
cp .env.example .env
# Edit .env with your Stripe test keys
```

4. **Run migrations**
```bash
npm run db:migrate
```

5. **Seed database (creates test tenant)**
```bash
npm run db:seed
```

6. **Start development server**
```bash
npm run dev
```

Server runs at `http://localhost:3000`

### Stripe Setup (Test Mode)

1. Create a Stripe account at https://stripe.com (no credit card required)
2. Get test API keys from https://dashboard.stripe.com/test/apikeys
3. Create a Product + Price for Pro plan ($49/month recurring)
4. Copy the Price ID to `STRIPE_PRO_PRICE_ID` in `.env`
5. Install Stripe CLI: https://stripe.com/docs/stripe-cli
6. Forward webhooks locally:
```bash
stripe listen --forward-to localhost:3000/webhooks/stripe
```
7. Copy the webhook signing secret (`whsec_...`) to `STRIPE_WEBHOOK_SECRET` in `.env`

## API Reference

### Headers
- `X-Tenant-ID`: Tenant UUID (required for all API routes)
- `Idempotency-Key`: Unique key per request (required for POST /meter)

### POST /api/v1/meter
Record a usage event.

**Request:**
```json
{
  "type": "api_call",
  "quantity": 1
}
```

```json
{
  "type": "ai_tokens",
  "quantity": 2500,
  "metadata": {
    "inputTokens": 1000,
    "cachedInputTokens": 100,
    "outputTokens": 500,
    "reasoningTokens": 50
  }
}
```

**Response (200):**
```json
{
  "success": true,
  "usageEvent": { ... },
  "quota": {
    "allowed": true,
    "remainingApiCalls": 850,
    "remainingAiTokens": 97500,
    "resetAt": "2026-11-01T00:00:00.000Z"
  },
  "duplicate": false
}
```

**Error Responses:**
- `400` - Missing/invalid idempotency key or request body
- `401` - Invalid tenant ID
- `402` - Subscription inactive
- `409` - Idempotency key reused with different payload
- `429` - Quota exceeded (includes `Retry-After` header)

### GET /api/v1/usage
Get current month's usage rollup.

**Response:**
```json
{
  "periodStart": "2026-10-01T00:00:00.000Z",
  "periodEnd": "2026-10-31T23:59:59.999Z",
  "plan": "free",
  "apiCalls": { "used": 150, "limit": 1000, "costCents": 0 },
  "aiTokens": { "used": 25000, "limit": 100000, "costCents": 125 },
  "totalCostCents": 125
}
```

### POST /api/v1/checkout
Create Stripe Checkout session for Pro upgrade.

**Response:**
```json
{
  "checkoutUrl": "https://checkout.stripe.com/pay/cs_test_..."
}
```

### GET /api/v1/subscription
Get current subscription status.

### POST /webhooks/stripe
Stripe webhook endpoint (signature verified).

## Testing with Stripe CLI

```bash
# Trigger checkout.session.completed
stripe trigger checkout.session.completed --add checkout_session:metadata[tenant_id]=<TENANT_ID>

# Trigger subscription updated
stripe trigger customer.subscription.updated --add subscription:metadata[tenant_id]=<TENANT_ID>

# Trigger subscription deleted
stripe trigger customer.subscription.deleted --add subscription:metadata[tenant_id]=<TENANT_ID>
```

## Idempotency Testing

```bash
# First request
curl -X POST http://localhost:3000/api/v1/meter \
  -H "X-Tenant-ID: <TENANT_ID>" \
  -H "Idempotency-Key: test-key-123" \
  -H "Content-Type: application/json" \
  -d '{"type": "api_call", "quantity": 1}'

# Retry with same key - returns same response, no duplicate
curl -X POST http://localhost:3000/api/v1/meter \
  -H "X-Tenant-ID: <TENANT_ID>" \
  -H "Idempotency-Key: test-key-123" \
  -H "Content-Type: application/json" \
  -d '{"type": "api_call", "quantity": 1}'
```

## Pricing Rules

| Token Type | Price per 1M | Notes |
|------------|--------------|-------|
| Input Tokens | $0.15 | Fresh input tokens |
| Cached Input Tokens | $0.0375 | 75% discount |
| Output Tokens | $0.60 | Standard output |
| Reasoning Tokens | $0.60 | Billed as output tokens |

All money stored as integer cents (no floating point).

## Plans

| Plan | API Calls/Month | AI Tokens/Month | Price |
|------|-----------------|-----------------|-------|
| Free | 1,000 | 100,000 | $0 |
| Pro | 10,000 | 1,000,000 | $49/month |

## Project Structure

```
src/
├── config/         # Configuration & constants
├── db/             # Database pool, migrations, seeds
├── middleware/     # Auth, validation, error handling
├── routes/         # API route handlers
├── services/       # Business logic (metering, pricing, stripe, cleanup)
├── types/          # TypeScript interfaces
├── utils/          # Utility functions
└── index.ts        # Application entry point
```

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start dev server with hot reload |
| `npm run build` | Compile TypeScript |
| `npm start` | Run compiled production build |
| `npm run db:up` | Start PostgreSQL container |
| `npm run db:down` | Stop PostgreSQL container |
| `npm run db:migrate` | Run database migrations |
| `npm run db:seed` | Seed test data |
| `npm test` | Run tests |

## Limitations

- No proration handling (stretch goal)
- No invoicing/PDF generation (stretch goal)
- No usage alerts/notifications (stretch goal)
- No overage billing (stretch goal)
- Single dummy billable endpoint for testing
- Token counts are simulated (no real AI model calls)

## License

MIT