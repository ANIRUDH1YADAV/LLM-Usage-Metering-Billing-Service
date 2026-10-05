import { pool, query } from './pool.js';
import { config } from '../config/index.js';

const proPriceId = config.stripe.proPriceId || 'price_pro_monthly';

const migrations = [
  `-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";`,

  `-- Tenants table
CREATE TABLE IF NOT EXISTS tenants (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    stripe_customer_id VARCHAR(255) UNIQUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);`,

  `-- Plans table
CREATE TABLE IF NOT EXISTS plans (
    id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    api_calls_limit INTEGER NOT NULL,
    ai_tokens_limit INTEGER NOT NULL,
    price_cents INTEGER NOT NULL DEFAULT 0,
    stripe_price_id VARCHAR(255),
    created_at TIMESTAMPTZ DEFAULT NOW()
);`,

  `-- Subscriptions table
CREATE TABLE IF NOT EXISTS subscriptions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    plan_id VARCHAR(50) NOT NULL REFERENCES plans(id),
    stripe_subscription_id VARCHAR(255) UNIQUE,
    status VARCHAR(50) NOT NULL DEFAULT 'incomplete',
    current_period_start TIMESTAMPTZ NOT NULL,
    current_period_end TIMESTAMPTZ NOT NULL,
    cancel_at_period_end BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);`,

  `-- Usage events table
CREATE TABLE IF NOT EXISTS usage_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    event_type VARCHAR(50) NOT NULL,
    quantity INTEGER NOT NULL,
    idempotency_key VARCHAR(255) NOT NULL,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (tenant_id, idempotency_key)
);`,

  `-- Indexes for usage_events
CREATE INDEX IF NOT EXISTS idx_usage_events_tenant_created ON usage_events(tenant_id, created_at);
CREATE INDEX IF NOT EXISTS idx_usage_events_idempotency ON usage_events(tenant_id, idempotency_key);`,

  `-- Idempotency keys table
CREATE TABLE IF NOT EXISTS idempotency_keys (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    key_hash VARCHAR(64) NOT NULL,
    request_hash VARCHAR(64) NOT NULL,
    response_status INTEGER,
    response_body JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    UNIQUE (tenant_id, key_hash)
);`,

  `-- Index for idempotency cleanup
CREATE INDEX IF NOT EXISTS idx_idempotency_expires ON idempotency_keys(expires_at);`,

  `-- Processed webhook events table (for deduplication)
CREATE TABLE IF NOT EXISTS processed_webhook_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    stripe_event_id VARCHAR(255) NOT NULL UNIQUE,
    event_type VARCHAR(100) NOT NULL,
    processed_at TIMESTAMPTZ DEFAULT NOW()
);`,

  `-- Seed plans
INSERT INTO plans (id, name, api_calls_limit, ai_tokens_limit, price_cents, stripe_price_id)
VALUES 
    ('free', 'Free', 1000, 100000, 0, NULL),
    ('pro', 'Pro', 10000, 1000000, 4900, '${proPriceId}')
ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    api_calls_limit = EXCLUDED.api_calls_limit,
    ai_tokens_limit = EXCLUDED.ai_tokens_limit,
    price_cents = EXCLUDED.price_cents,
    stripe_price_id = EXCLUDED.stripe_price_id;`,
];

export async function runMigrations(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    for (const migration of migrations) {
      await client.query(migration);
    }
    
    await client.query('COMMIT');
    console.log('Migrations completed successfully');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Migration failed:', error);
    throw error;
  } finally {
    client.release();
  }
}

export async function rollbackMigrations(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    await client.query('DROP TABLE IF EXISTS processed_webhook_events CASCADE');
    await client.query('DROP TABLE IF EXISTS idempotency_keys CASCADE');
    await client.query('DROP TABLE IF EXISTS usage_events CASCADE');
    await client.query('DROP TABLE IF EXISTS subscriptions CASCADE');
    await client.query('DROP TABLE IF EXISTS plans CASCADE');
    await client.query('DROP TABLE IF EXISTS tenants CASCADE');
    
    await client.query('COMMIT');
    console.log('Rollback completed');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Rollback failed:', error);
    throw error;
  } finally {
    client.release();
  }
}

// CLI entry point - check if run directly
const isMainModule = process.argv[1] && process.argv[1].endsWith('migrate.ts');
if (isMainModule) {
  (async () => {
    const command = process.argv[2];
    if (command === 'rollback') {
      await rollbackMigrations();
    } else {
      await runMigrations();
    }
    await pool.end();
    process.exit(0);
  })();
}