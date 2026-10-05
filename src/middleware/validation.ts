import { z, ZodSchema } from 'zod';
import { Request, Response, NextFunction } from 'express';

export const meterRequestSchema = z.object({
  type: z.enum(['api_call', 'ai_tokens']),
  quantity: z.number().int().positive(),
  metadata: z.object({
    inputTokens: z.number().int().nonnegative().optional(),
    cachedInputTokens: z.number().int().nonnegative().optional(),
    outputTokens: z.number().int().nonnegative().optional(),
    reasoningTokens: z.number().int().nonnegative().optional(),
  }).optional(),
});

export const checkoutRequestSchema = z.object({
  // No body needed, but keep for extensibility
}).optional();

export type MeterRequest = z.infer<typeof meterRequestSchema>;
export type CheckoutRequest = z.infer<typeof checkoutRequestSchema>;

export function validateBody(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      res.status(400).json({ error: 'Invalid request body', details: result.error.flatten() });
      return;
    }
    req.body = result.data;
    next();
  };
}