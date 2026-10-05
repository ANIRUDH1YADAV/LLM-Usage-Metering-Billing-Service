export interface Tenant {
  id: string;
  name: string;
  stripeCustomerId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Plan {
  id: string;
  name: string;
  apiCallsLimit: number;
  aiTokensLimit: number;
  priceCents: number;
  stripePriceId: string | null;
  createdAt: Date;
  // Database column aliases (snake_case)
  api_calls_limit?: number;
  ai_tokens_limit?: number;
}

export interface Subscription {
  id: string;
  tenantId: string;
  planId: string;
  stripeSubscriptionId: string | null;
  status: SubscriptionStatus;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  cancelAtPeriodEnd: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export type SubscriptionStatus = 'active' | 'canceled' | 'past_due' | 'trialing' | 'incomplete';

export interface UsageEvent {
  id: string;
  tenantId: string;
  eventType: UsageEventType;
  quantity: number;
  idempotencyKey: string;
  metadata: TokenMetadata;
  createdAt: Date;
}

export type UsageEventType = 'api_call' | 'ai_tokens';

export interface TokenMetadata {
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  [key: string]: unknown;
}

export interface IdempotencyRecord {
  id: string;
  tenantId: string;
  keyHash: string;
  requestHash: string;
  responseStatus: number | null;
  responseBody: Record<string, unknown> | null;
  createdAt: Date;
  expiresAt: Date;
}

export interface UsageRollup {
  periodStart: Date;
  periodEnd: Date;
  plan: string;
  apiCalls: UsageMetric;
  aiTokens: UsageMetric;
  totalCostCents: number;
}

export interface UsageMetric {
  used: number;
  limit: number;
  costCents: number;
}

export interface MeterRequest {
  type: UsageEventType;
  quantity: number;
  metadata?: TokenMetadata;
}

export interface MeterResponse {
  success: true;
  usageEvent: UsageEvent;
  quota: QuotaStatus;
}

export interface QuotaStatus {
  allowed: boolean;
  remainingApiCalls: number;
  remainingAiTokens: number;
  resetAt: Date;
}

export interface QuotaExceededError {
  error: string;
  code: 'QUOTA_EXCEEDED' | 'SUBSCRIPTION_INACTIVE';
  retryAfter?: number;
  resetAt?: Date;
}

export interface CheckoutResponse {
  checkoutUrl: string;
}

export interface StripeWebhookEvent {
  id: string;
  type: string;
  data: {
    object: Record<string, unknown>;
  };
  created: number;
}

export interface ProcessedWebhookEvent {
  id: string;
  stripeEventId: string;
  eventType: string;
  processedAt: Date;
}