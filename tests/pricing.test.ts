import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { calculateTokenCost, getTokenBreakdown } from '../src/services/pricing.js';

describe('Pricing Service', () => {
  describe('calculateTokenCost', () => {
    it('should calculate cost for fresh input tokens only', () => {
      const result = calculateTokenCost({
        inputTokens: 1_000_000,
        cachedInputTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
      });
      
      // 1M input tokens at $0.15/M = 15 cents
      expect(result.inputCostCents).toBe(15);
      expect(result.cachedInputCostCents).toBe(0);
      expect(result.outputCostCents).toBe(0);
      expect(result.reasoningCostCents).toBe(0);
      expect(result.totalCostCents).toBe(15);
    });

    it('should calculate cost for cached input tokens with discount', () => {
      const result = calculateTokenCost({
        inputTokens: 1_000_000,
        cachedInputTokens: 1_000_000,
        outputTokens: 0,
        reasoningTokens: 0,
      });
      
      // All cached: 1M at $0.0375/M = 3.75 cents → rounded to 4 cents
      expect(result.inputCostCents).toBe(0);
      expect(result.cachedInputCostCents).toBe(4);
      expect(result.totalCostCents).toBe(4);
    });

    it('should calculate cost for mixed fresh and cached input', () => {
      const result = calculateTokenCost({
        inputTokens: 1_500_000,
        cachedInputTokens: 500_000,
        outputTokens: 0,
        reasoningTokens: 0,
      });
      
      // 1M fresh at $0.15/M = 15 cents
      // 500K cached at $0.0375/M = 1.875 cents → 2 cents
      expect(result.inputCostCents).toBe(15);
      expect(result.cachedInputCostCents).toBe(2);
      expect(result.totalCostCents).toBe(17);
    });

    it('should bill reasoning tokens as output tokens', () => {
      const result = calculateTokenCost({
        inputTokens: 0,
        cachedInputTokens: 0,
        outputTokens: 500_000,
        reasoningTokens: 500_000,
      });
      
      // 1M total output at $0.60/M = 60 cents
      expect(result.outputCostCents).toBe(30); // 500K * 0.60
      expect(result.reasoningCostCents).toBe(30); // 500K * 0.60
      expect(result.totalCostCents).toBe(60);
    });

    it('should handle complex token breakdown', () => {
      const result = calculateTokenCost({
        inputTokens: 2_000_000,
        cachedInputTokens: 500_000,
        outputTokens: 1_000_000,
        reasoningTokens: 200_000,
      });
      
      // Fresh input: 1.5M * 0.15 = 22.5 cents
      // Cached input: 500K * 0.0375 = 1.875 cents → 2 cents
      // Output: 1M * 0.60 = 60 cents
      // Reasoning: 200K * 0.60 = 12 cents
      // Total: ~96.5 cents
      expect(result.totalCostCents).toBeGreaterThan(95);
      expect(result.totalCostCents).toBeLessThan(98);
    });

    it('should return zero for empty metadata', () => {
      const result = calculateTokenCost({});
      expect(result.totalCostCents).toBe(0);
    });
  });

  describe('getTokenBreakdown', () => {
    it('should extract token counts from metadata', () => {
      const breakdown = getTokenBreakdown({
        inputTokens: 1000,
        cachedInputTokens: 100,
        outputTokens: 500,
        reasoningTokens: 50,
      });
      
      expect(breakdown.inputTokens).toBe(1000);
      expect(breakdown.cachedInputTokens).toBe(100);
      expect(breakdown.outputTokens).toBe(500);
      expect(breakdown.reasoningTokens).toBe(50);
    });

    it('should default missing values to zero', () => {
      const breakdown = getTokenBreakdown({});
      expect(breakdown.inputTokens).toBe(0);
      expect(breakdown.cachedInputTokens).toBe(0);
      expect(breakdown.outputTokens).toBe(0);
      expect(breakdown.reasoningTokens).toBe(0);
    });
  });
});