import { Request, Response, NextFunction } from 'express';
import { query } from '../db/pool.js';
import { config } from '../config/index.js';

export interface AuthenticatedRequest extends Request {
  tenantId?: string;
  tenant?: { id: string; name: string; stripeCustomerId: string | null };
}

interface TenantRow {
  id: string;
  name: string;
  stripe_customer_id: string | null;
}

/**
 * Middleware to extract and validate tenant from X-Tenant-ID header
 */
export async function requireTenant(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const tenantId = req.headers['x-tenant-id'] as string;

  if (!tenantId) {
    res.status(401).json({ error: 'Missing X-Tenant-ID header' });
    return;
  }

  // Validate UUID format
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(tenantId)) {
    res.status(401).json({ error: 'Invalid tenant ID format' });
    return;
  }

  // Verify tenant exists
  const result = await query<TenantRow>(
    'SELECT id, name, stripe_customer_id FROM tenants WHERE id = $1',
    [tenantId]
  );

  if (result.rows.length === 0) {
    res.status(401).json({ error: 'Invalid tenant ID' });
    return;
  }

  req.tenantId = tenantId;
  req.tenant = {
    id: result.rows[0].id,
    name: result.rows[0].name,
    stripeCustomerId: result.rows[0].stripe_customer_id,
  };
  next();
}

/**
 * Middleware to require idempotency key for mutating endpoints
 */
export function requireIdempotencyKey(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void {
  const idempotencyKey = req.headers['idempotency-key'] as string;

  if (!idempotencyKey) {
    res.status(400).json({ error: 'Missing Idempotency-Key header' });
    return;
  }

  if (idempotencyKey.length > 255) {
    res.status(400).json({ error: 'Idempotency-Key too long (max 255 characters)' });
    return;
  }

  // Store for use in route handler
  (req as any).idempotencyKey = idempotencyKey;
  next();
}

/**
 * Global error handler
 */
export function errorHandler(
  err: Error,
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void {
  console.error('Error:', err);

  // Idempotency key conflict
  if (err.message.startsWith('IDEMPOTENCY_KEY_CONFLICT')) {
    res.status(409).json({ error: 'Idempotency key reused with different request payload' });
    return;
  }

  // Quota exceeded errors
  if (err.message.startsWith('QUOTA_EXCEEDED:')) {
    const code = err.message.split(':')[1];
    const isApiQuota = code === 'API_QUOTA_EXCEEDED';
    
    // Get reset time for retry-after header
    const periodEnd = new Date();
    periodEnd.setDate(1);
    periodEnd.setMonth(periodEnd.getMonth() + 1);
    periodEnd.setHours(0, 0, 0, 0);
    const retryAfter = Math.ceil((periodEnd.getTime() - Date.now()) / 1000);

    res.set('Retry-After', String(retryAfter));
    
    if (isApiQuota) {
      res.status(429).json({
        error: 'Monthly API call quota exceeded',
        code: 'QUOTA_EXCEEDED',
        retryAfter,
        resetAt: periodEnd.toISOString(),
      });
    } else {
      res.status(429).json({
        error: 'Monthly AI token quota exceeded',
        code: 'QUOTA_EXCEEDED',
        retryAfter,
        resetAt: periodEnd.toISOString(),
      });
    }
    return;
  }

  // Tenant not found
  if (err.message === 'TENANT_NOT_FOUND') {
    res.status(401).json({ error: 'Tenant not found' });
    return;
  }

  // No active subscription
  if (err.message === 'No active subscription found') {
    res.status(402).json({ error: 'No active subscription. Please upgrade your plan.' });
    return;
  }

  // Default to 500 for unknown errors
  res.status(500).json({ error: 'Internal server error' });
}