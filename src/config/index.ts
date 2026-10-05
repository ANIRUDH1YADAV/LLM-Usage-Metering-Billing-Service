import dotenv from 'dotenv';
dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  
  database: {
    url: process.env.DATABASE_URL || 'postgresql://metering:metering@localhost:5432/metering',
  },

  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY || '',
    publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || '',
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
    proPriceId: process.env.STRIPE_PRO_PRICE_ID || '',
  },

  app: {
    url: process.env.APP_URL || 'http://localhost:3000',
  },

  // AI Token Pricing Constants (per 1M tokens, in cents)
  pricing: {
    inputTokenPricePerM: 150,        // $0.15 per 1M input tokens
    cachedInputTokenPricePerM: 37.5, // $0.0375 per 1M cached input tokens (75% discount)
    outputTokenPricePerM: 600,       // $0.60 per 1M output tokens
    reasoningTokenPricePerM: 600,    // $0.60 per 1M reasoning tokens (billed as output)
  },

  // Plans configuration
  plans: {
    free: {
      id: 'free',
      name: 'Free',
      apiCallsLimit: 1000,
      aiTokensLimit: 100000,
      priceCents: 0,
    },
    pro: {
      id: 'pro',
      name: 'Pro',
      apiCallsLimit: 10000,
      aiTokensLimit: 1000000,
      priceCents: 4900, // $49/month
    },
  },

  // Idempotency key TTL (24 hours)
  idempotencyTtlHours: 24,
} as const;

export type Config = typeof config;