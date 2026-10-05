import { query, getClient } from '../db/pool.js';
import { config } from '../config/index.js';
import type { UsageEvent, MeterRequest, MeterResponse, QuotaStatus, TokenMetadata, Plan } from '../types/index.js';
import { calculateTokenCost, getTokenBreakdown } from './pricing.js';
import crypto from 'crypto';

export class MeteringService {
  /**
   * Hash an idempotency key for storage
   */
  private static hashKey(key: string): string {
    return crypto.createHash('sha256').update(key).digest('hex');
  }

  /**
   * Hash request body for validation
   */
  private static hashRequest(body: MeterRequest): string {
    const normalized = JSON.stringify(body, Object.keys(body).sort());
    return crypto.createHash('sha256').update(normalized).digest('hex');
  }

  /**
   * Record a usage event with idempotency
   */
  static async recordUsage(
    tenantId: string,
    request: MeterRequest,
    idempotencyKey: string
  ): Promise<{ event: UsageEvent; isDuplicate: boolean; quota: QuotaStatus }> {
    const keyHash = this.hashKey(idempotencyKey);
    const requestHash = this.hashRequest(request);
    const expiresAt = new Date(Date.now() + config.idempotencyTtlHours * 60 * 60 * 1000);

    const client = await getClient();
    try {
      await client.query('BEGIN');

      // Check for existing idempotency key
      const existingKey = await client.query(
        `SELECT response_status, response_body FROM idempotency_keys 
         WHERE tenant_id = $1 AND key_hash = $2 AND expires_at > NOW()`,
        [tenantId, keyHash]
      );

      if (existingKey.rows.length > 0) {
        const existing = existingKey.rows[0];
        // Validate request matches
        if (existing.request_hash !== requestHash) {
          await client.query('ROLLBACK');
          throw new Error('IDEMPOTENCY_KEY_CONFLICT: Key reused with different request payload');
        }
        // Return cached response
        await client.query('COMMIT');
        return {
          event: existing.response_body as UsageEvent,
          isDuplicate: true,
          quota: await this.getQuotaStatus(client, tenantId),
        };
      }

      // Get tenant's current plan and subscription
      const tenantPlan = await this.getTenantPlan(client, tenantId);
      if (!tenantPlan) {
        await client.query('ROLLBACK');
        throw new Error('TENANT_NOT_FOUND');
      }

      // Check quota before recording
      const quota = await this.checkQuota(client, tenantId, tenantPlan, request);
      if (!quota.allowed) {
        await client.query('ROLLBACK');
        throw new Error(`QUOTA_EXCEEDED:${quota.code}`);
      }

      // Insert usage event
      const eventResult = await client.query(
        `INSERT INTO usage_events (tenant_id, event_type, quantity, idempotency_key, metadata)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, tenant_id, event_type, quantity, idempotency_key, metadata, created_at`,
        [tenantId, request.type, request.quantity, idempotencyKey, JSON.stringify(request.metadata || {})]
      );

      const event = eventResult.rows[0] as UsageEvent;

      // Store idempotency key with response
      await client.query(
        `INSERT INTO idempotency_keys (tenant_id, key_hash, request_hash, response_status, response_body, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [tenantId, keyHash, requestHash, 200, JSON.stringify(event), expiresAt]
      );

      await client.query('COMMIT');

      return { event, isDuplicate: false, quota: await this.getQuotaStatus(client, tenantId) };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Get tenant's current plan
   */
  private static async getTenantPlan(client: any, tenantId: string): Promise<Plan | null> {
    const result = await client.query(
      `SELECT p.* FROM plans p
       JOIN subscriptions s ON s.plan_id = p.id
       WHERE s.tenant_id = $1 AND s.status = 'active'
       ORDER BY s.current_period_end DESC
       LIMIT 1`,
      [tenantId]
    );
    return result.rows[0] || null;
  }

  /**
   * Check if request would exceed quota
   */
  private static async checkQuota(
    client: any,
    tenantId: string,
    plan: Plan,
    request: MeterRequest
  ): Promise<QuotaStatus & { code: string }> {
    // Get current period usage
    const periodStart = new Date();
    periodStart.setDate(1);
    periodStart.setHours(0, 0, 0, 0);
    const periodEnd = new Date(periodStart);
    periodEnd.setMonth(periodEnd.getMonth() + 1);
    periodEnd.setMilliseconds(periodEnd.getMilliseconds() - 1);

    const usageResult = await client.query(
      `SELECT 
        COALESCE(SUM(CASE WHEN event_type = 'api_call' THEN quantity ELSE 0 END), 0) as api_calls,
        COALESCE(SUM(CASE WHEN event_type = 'ai_tokens' THEN quantity ELSE 0 END), 0) as ai_tokens
       FROM usage_events
       WHERE tenant_id = $1 AND created_at >= $2 AND created_at <= $3`,
      [tenantId, periodStart, periodEnd]
    );

    const currentApiCalls = parseInt(usageResult.rows[0].api_calls, 10);
    const currentAiTokens = parseInt(usageResult.rows[0].ai_tokens, 10);

    let allowed = true;
    let code = 'OK';

    const apiCallsLimit = (plan as any).api_calls_limit ?? plan.apiCallsLimit;
    const aiTokensLimit = (plan as any).ai_tokens_limit ?? plan.aiTokensLimit;

    if (request.type === 'api_call') {
      if (currentApiCalls + request.quantity > apiCallsLimit) {
        allowed = false;
        code = 'API_QUOTA_EXCEEDED';
      }
    } else if (request.type === 'ai_tokens') {
      if (currentAiTokens + request.quantity > aiTokensLimit) {
        allowed = false;
        code = 'TOKEN_QUOTA_EXCEEDED';
      }
    }

    return {
      allowed,
      code,
      remainingApiCalls: Math.max(0, apiCallsLimit - currentApiCalls),
      remainingAiTokens: Math.max(0, aiTokensLimit - currentAiTokens),
      resetAt: periodEnd,
    };
  }

  /**
   * Get current quota status for tenant
   */
  static async getQuotaStatus(client: any, tenantId: string): Promise<QuotaStatus> {
    const plan = await this.getTenantPlan(client, tenantId);
    if (!plan) {
      return {
        allowed: false,
        remainingApiCalls: 0,
        remainingAiTokens: 0,
        resetAt: new Date(),
      };
    }

    const periodStart = new Date();
    periodStart.setDate(1);
    periodStart.setHours(0, 0, 0, 0);
    const periodEnd = new Date(periodStart);
    periodEnd.setMonth(periodEnd.getMonth() + 1);
    periodEnd.setMilliseconds(periodEnd.getMilliseconds() - 1);

    const usageResult = await client.query(
      `SELECT 
        COALESCE(SUM(CASE WHEN event_type = 'api_call' THEN quantity ELSE 0 END), 0) as api_calls,
        COALESCE(SUM(CASE WHEN event_type = 'ai_tokens' THEN quantity ELSE 0 END), 0) as ai_tokens
       FROM usage_events
       WHERE tenant_id = $1 AND created_at >= $2 AND created_at <= $3`,
      [tenantId, periodStart, periodEnd]
    );

    const currentApiCalls = parseInt(usageResult.rows[0].api_calls, 10);
    const currentAiTokens = parseInt(usageResult.rows[0].ai_tokens, 10);

    const apiCallsLimit = (plan as any).api_calls_limit ?? plan.apiCallsLimit;
    const aiTokensLimit = (plan as any).ai_tokens_limit ?? plan.aiTokensLimit;

    return {
      allowed: true,
      remainingApiCalls: Math.max(0, apiCallsLimit - currentApiCalls),
      remainingAiTokens: Math.max(0, aiTokensLimit - currentAiTokens),
      resetAt: periodEnd,
    };
  }

  /**
   * Get usage rollup for current billing period
   */
  static async getUsageRollup(tenantId: string): Promise<{
    periodStart: Date;
    periodEnd: Date;
    plan: string;
    apiCalls: { used: number; limit: number; costCents: number };
    aiTokens: { used: number; limit: number; costCents: number };
    totalCostCents: number;
  }> {
    const planResult = await query(
      `SELECT p.* FROM plans p
       JOIN subscriptions s ON s.plan_id = p.id
       WHERE s.tenant_id = $1 AND s.status = 'active'
       ORDER BY s.current_period_end DESC
       LIMIT 1`,
      [tenantId]
    );

    const plan = planResult.rows[0] as Plan;
    if (!plan) {
      throw new Error('No active subscription found');
    }

    const periodStart = new Date();
    periodStart.setDate(1);
    periodStart.setHours(0, 0, 0, 0);
    const periodEnd = new Date(periodStart);
    periodEnd.setMonth(periodEnd.getMonth() + 1);
    periodEnd.setMilliseconds(periodEnd.getMilliseconds() - 1);

    // Get usage events with metadata for cost calculation
    const usageResult = await query(
      `SELECT event_type, quantity, metadata FROM usage_events
       WHERE tenant_id = $1 AND created_at >= $2 AND created_at <= $3
       ORDER BY created_at`,
      [tenantId, periodStart, periodEnd]
    );

    let apiCallsUsed = 0;
    let aiTokensUsed = 0;
    let totalTokenCostCents = 0;

    for (const row of usageResult.rows) {
      if (row.event_type === 'api_call') {
        apiCallsUsed += row.quantity;
      } else if (row.event_type === 'ai_tokens') {
        aiTokensUsed += row.quantity;
        const cost = calculateTokenCost(row.metadata as TokenMetadata);
        totalTokenCostCents += cost.totalCostCents;
      }
    }

    const apiCallsLimit = (plan as any).api_calls_limit ?? plan.apiCallsLimit;
    const aiTokensLimit = (plan as any).ai_tokens_limit ?? plan.aiTokensLimit;

    return {
      periodStart,
      periodEnd,
      plan: plan.id,
      apiCalls: {
        used: apiCallsUsed,
        limit: apiCallsLimit,
        costCents: 0, // API calls included in plan
      },
      aiTokens: {
        used: aiTokensUsed,
        limit: aiTokensLimit,
        costCents: totalTokenCostCents,
      },
      totalCostCents: totalTokenCostCents,
    };
  }

  /**
   * Clean up expired idempotency keys (run as background job)
   */
  static async cleanupExpiredKeys(): Promise<number> {
    const result = await query(
      `DELETE FROM idempotency_keys WHERE expires_at < NOW()`
    );
    return result.rowCount || 0;
  }
}