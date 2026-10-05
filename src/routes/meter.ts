import { Router, Response } from 'express';
import { MeteringService } from '../services/metering.js';
import { requireTenant, requireIdempotencyKey, AuthenticatedRequest } from '../middleware/auth.js';
import { validateBody } from '../middleware/validation.js';
import { meterRequestSchema } from '../middleware/validation.js';

const router = Router();

/**
 * POST /api/v1/meter
 * Record a usage event (idempotent)
 */
router.post(
  '/meter',
  requireTenant,
  requireIdempotencyKey,
  validateBody(meterRequestSchema),
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const tenantId = req.tenantId!;
      const idempotencyKey = (req as any).idempotencyKey;
      const request = req.body;

      const result = await MeteringService.recordUsage(tenantId, request, idempotencyKey);

      res.status(200).json({
        success: true,
        usageEvent: result.event,
        quota: result.quota,
        duplicate: result.isDuplicate,
      });
    } catch (error) {
      // Re-throw to be caught by error handler
      throw error;
    }
  }
);

/**
 * GET /api/v1/usage
 * Get current month's usage rollup for tenant
 */
router.get(
  '/usage',
  requireTenant,
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const tenantId = req.tenantId!;
      const rollup = await MeteringService.getUsageRollup(tenantId);
      res.json(rollup);
    } catch (error) {
      throw error;
    }
  }
);

export default router;