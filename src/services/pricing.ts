import { config } from '../config/index.js';
import type { TokenMetadata } from '../types/index.js';

export interface TokenBreakdown {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
}

export interface CostBreakdown {
  inputCostCents: number;
  cachedInputCostCents: number;
  outputCostCents: number;
  reasoningCostCents: number;
  totalCostCents: number;
}

/**
 * Calculate AI token costs based on pricing rules:
 * - Cached input tokens are cheaper (75% discount)
 * - Reasoning tokens count as output tokens
 * - Token categories cannot simply be added together
 */
export function calculateTokenCost(metadata: TokenMetadata): CostBreakdown {
  const inputTokens = metadata.inputTokens || 0;
  const cachedInputTokens = metadata.cachedInputTokens || 0;
  const outputTokens = metadata.outputTokens || 0;
  const reasoningTokens = metadata.reasoningTokens || 0;

  // Fresh input tokens (excluding cached)
  const freshInputTokens = Math.max(0, inputTokens - cachedInputTokens);

  // Calculate costs in micro-cents for precision, then convert to cents
  const inputCostMicroCents = Math.round(
    freshInputTokens * config.pricing.inputTokenPricePerM * 100 / 1_000_000
  );
  const cachedInputCostMicroCents = Math.round(
    cachedInputTokens * config.pricing.cachedInputTokenPricePerM * 100 / 1_000_000
  );
  const outputCostMicroCents = Math.round(
    outputTokens * config.pricing.outputTokenPricePerM * 100 / 1_000_000
  );
  const reasoningCostMicroCents = Math.round(
    reasoningTokens * config.pricing.reasoningTokenPricePerM * 100 / 1_000_000
  );

  // Convert micro-cents to cents (divide by 100, round)
  const inputCostCents = Math.round(inputCostMicroCents / 100);
  const cachedInputCostCents = Math.round(cachedInputCostMicroCents / 100);
  const outputCostCents = Math.round(outputCostMicroCents / 100);
  const reasoningCostCents = Math.round(reasoningCostMicroCents / 100);

  const totalCostCents = inputCostCents + cachedInputCostCents + outputCostCents + reasoningCostCents;

  return {
    inputCostCents,
    cachedInputCostCents,
    outputCostCents,
    reasoningCostCents,
    totalCostCents,
  };
}

/**
 * Calculate API call cost (simple flat rate per call)
 * For this capstone, API calls are included in the plan, no additional cost
 */
export function calculateApiCallCost(callCount: number): number {
  // API calls are covered by plan quota, no per-call charge in this model
  return 0;
}

/**
 * Get token breakdown from metadata
 */
export function getTokenBreakdown(metadata: TokenMetadata): TokenBreakdown {
  return {
    inputTokens: metadata.inputTokens || 0,
    cachedInputTokens: metadata.cachedInputTokens || 0,
    outputTokens: metadata.outputTokens || 0,
    reasoningTokens: metadata.reasoningTokens || 0,
  };
}