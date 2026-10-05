import { pool, query } from './pool.js';
import { config } from '../config/index.js';

export async function seedDatabase(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Create a test tenant
    const tenantResult = await client.query(
      `INSERT INTO tenants (name, stripe_customer_id) 
       VALUES ('Test Tenant', 'cus_test_123') 
       ON CONFLICT (stripe_customer_id) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`
    );
    const tenantId = tenantResult.rows[0].id;
    console.log(`Created/updated tenant: ${tenantId}`);

    // Create a subscription for the tenant (Free plan)
    await client.query(
      `INSERT INTO subscriptions (tenant_id, plan_id, status, current_period_start, current_period_end)
       VALUES ($1, 'free', 'active', NOW(), NOW() + INTERVAL '1 month')
       ON CONFLICT (tenant_id) DO UPDATE SET 
         plan_id = 'free',
         status = 'active',
         current_period_start = NOW(),
         current_period_end = NOW() + INTERVAL '1 month'`,
      [tenantId]
    );
    console.log(`Created/updated subscription for tenant: ${tenantId}`);

    await client.query('COMMIT');
    console.log('Database seeded successfully');
    console.log(`Test tenant ID: ${tenantId}`);
    console.log('Use this tenant ID in X-Tenant-ID header for testing');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Seeding failed:', error);
    throw error;
  } finally {
    client.release();
  }
}

// CLI entry point - check if run directly
const isMainModule = process.argv[1] && process.argv[1].endsWith('seed.ts');
if (isMainModule) {
  (async () => {
    await seedDatabase();
    await pool.end();
    process.exit(0);
  })();
}