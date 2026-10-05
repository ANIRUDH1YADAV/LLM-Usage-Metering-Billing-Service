import { Router, Response } from 'express';
import { StripeService } from '../services/stripe.js';
import { requireTenant, AuthenticatedRequest } from '../middleware/auth.js';

const router = Router();

/**
 * POST /api/v1/checkout
 * Create Stripe Checkout session for Pro upgrade
 */
router.post(
  '/checkout',
  requireTenant,
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const tenantId = req.tenantId!;
      const checkoutUrl = await StripeService.createCheckoutSession(tenantId);
      
      res.json({ checkoutUrl });
    } catch (error) {
      throw error;
    }
  }
);

/**
 * GET /api/v1/subscription
 * Get current subscription status
 */
router.get(
  '/subscription',
  requireTenant,
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const tenantId = req.tenantId!;
      
      const result = await req.app.locals.db.query(
        `SELECT s.*, p.name as plan_name, p.api_calls_limit, p.ai_tokens_limit, p.price_cents
         FROM subscriptions s
         JOIN plans p ON p.id = s.plan_id
         WHERE s.tenant_id = $1
         ORDER BY s.created_at DESC
         LIMIT 1`,
        [tenantId]
      );

      if (result.rows.length === 0) {
        res.status(404).json({ error: 'No subscription found' });
        return;
      }

      const sub = result.rows[0];
      res.json({
        plan: sub.plan_id,
        planName: sub.plan_name,
        status: sub.status,
        apiCallsLimit: sub.api_calls_limit,
        aiTokensLimit: sub.ai_tokens_limit,
        priceCents: sub.price_cents,
        currentPeriodStart: sub.current_period_start,
        currentPeriodEnd: sub.current_period_end,
        cancelAtPeriodEnd: sub.cancel_at_period_end,
      });
    } catch (error) {
      throw error;
    }
  }
);

export default router;