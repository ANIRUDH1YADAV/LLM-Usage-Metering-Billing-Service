import Stripe from 'stripe';
import { config } from '../config/index.js';
import { query, getClient } from '../db/pool.js';
import type { SubscriptionStatus } from '../types/index.js';

const stripe = new Stripe(config.stripe.secretKey, {
  apiVersion: '2024-04-10',
  typescript: true,
});

export class StripeService {
  /**
   * Create a Checkout session for Pro subscription
   */
  static async createCheckoutSession(tenantId: string, customerEmail?: string): Promise<string> {
    // Get or create Stripe customer
    let customerId = await this.getOrCreateStripeCustomer(tenantId, customerEmail);

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [
        {
          price: config.stripe.proPriceId,
          quantity: 1,
        },
      ],
      success_url: `${config.app.url}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${config.app.url}/checkout/cancel`,
      metadata: {
        tenant_id: tenantId,
      },
      subscription_data: {
        metadata: {
          tenant_id: tenantId,
        },
      },
    });

    return session.url || '';
  }

  /**
   * Get or create Stripe customer for tenant
   */
  private static async getOrCreateStripeCustomer(tenantId: string, email?: string): Promise<string> {
    const result = await query(
      'SELECT stripe_customer_id FROM tenants WHERE id = $1',
      [tenantId]
    );

    if (result.rows[0]?.stripe_customer_id) {
      return result.rows[0].stripe_customer_id;
    }

    // Create new customer
    const customer = await stripe.customers.create({
      email: email || `tenant_${tenantId}@example.com`,
      metadata: { tenant_id: tenantId },
    });

    await query(
      'UPDATE tenants SET stripe_customer_id = $1 WHERE id = $2',
      [customer.id, tenantId]
    );

    return customer.id;
  }

  /**
   * Handle checkout.session.completed webhook
   */
  static async handleCheckoutCompleted(session: Stripe.Checkout.Session): Promise<void> {
    const tenantId = session.metadata?.tenant_id;
    if (!tenantId) {
      throw new Error('No tenant_id in session metadata');
    }

    const subscriptionId = session.subscription as string;
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);

    await this.syncSubscription(tenantId, subscription);
  }

  /**
   * Handle customer.subscription.updated webhook
   */
  static async handleSubscriptionUpdated(subscription: Stripe.Subscription): Promise<void> {
    const tenantId = subscription.metadata?.tenant_id;
    if (!tenantId) {
      // Try to get from customer
      const customer = await stripe.customers.retrieve(subscription.customer as string);
      const tenantIdFromCustomer = (customer as Stripe.Customer).metadata?.tenant_id;
      if (!tenantIdFromCustomer) {
        throw new Error('No tenant_id in subscription or customer metadata');
      }
      await this.syncSubscription(tenantIdFromCustomer, subscription);
      return;
    }

    await this.syncSubscription(tenantId, subscription);
  }

  /**
   * Handle customer.subscription.deleted webhook
   */
  static async handleSubscriptionDeleted(subscription: Stripe.Subscription): Promise<void> {
    const tenantId = subscription.metadata?.tenant_id;
    if (!tenantId) {
      const customer = await stripe.customers.retrieve(subscription.customer as string);
      const tenantIdFromCustomer = (customer as Stripe.Customer).metadata?.tenant_id;
      if (!tenantIdFromCustomer) {
        throw new Error('No tenant_id in subscription or customer metadata');
      }
      await this.revertToFree(tenantIdFromCustomer);
      return;
    }

    await this.revertToFree(tenantId);
  }

  /**
   * Sync subscription from Stripe to database
   */
  private static async syncSubscription(tenantId: string, subscription: Stripe.Subscription): Promise<void> {
    const client = await getClient();
    try {
      await client.query('BEGIN');

      // Determine plan from subscription items
      const priceId = subscription.items.data[0]?.price.id;
      let planId = 'free';
      
      if (priceId === config.stripe.proPriceId) {
        planId = 'pro';
      }

      const status = this.mapStripeStatus(subscription.status) as SubscriptionStatus;
      const currentPeriodStart = new Date(subscription.current_period_start * 1000);
      const currentPeriodEnd = new Date(subscription.current_period_end * 1000);

      await client.query(
        `INSERT INTO subscriptions (tenant_id, plan_id, stripe_subscription_id, status, current_period_start, current_period_end, cancel_at_period_end)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (tenant_id) DO UPDATE SET
           plan_id = EXCLUDED.plan_id,
           stripe_subscription_id = EXCLUDED.stripe_subscription_id,
           status = EXCLUDED.status,
           current_period_start = EXCLUDED.current_period_start,
           current_period_end = EXCLUDED.current_period_end,
           cancel_at_period_end = EXCLUDED.cancel_at_period_end,
           updated_at = NOW()`,
        [tenantId, planId, subscription.id, status, currentPeriodStart, currentPeriodEnd, subscription.cancel_at_period_end]
      );

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Revert tenant to Free plan
   */
  private static async revertToFree(tenantId: string): Promise<void> {
    const client = await getClient();
    try {
      await client.query('BEGIN');

      await client.query(
        `UPDATE subscriptions 
         SET plan_id = 'free', status = 'canceled', updated_at = NOW()
         WHERE tenant_id = $1`,
        [tenantId]
      );

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Map Stripe subscription status to our status
   */
  private static mapStripeStatus(status: Stripe.Subscription.Status): string {
    switch (status) {
      case 'active':
      case 'trialing':
        return 'active';
      case 'past_due':
        return 'past_due';
      case 'canceled':
      case 'unpaid':
        return 'canceled';
      case 'incomplete':
      case 'incomplete_expired':
        return 'incomplete';
      default:
        return 'incomplete';
    }
  }

  /**
   * Verify webhook signature
   */
  static verifyWebhookSignature(payload: string | Buffer, signature: string): Stripe.Event {
    return stripe.webhooks.constructEvent(
      payload,
      signature,
      config.stripe.webhookSecret
    );
  }

  /**
   * Check if webhook event was already processed
   */
  static async isEventProcessed(eventId: string): Promise<boolean> {
    const result = await query(
      'SELECT 1 FROM processed_webhook_events WHERE stripe_event_id = $1',
      [eventId]
    );
    return result.rows.length > 0;
  }

  /**
   * Mark webhook event as processed
   */
  static async markEventProcessed(eventId: string, eventType: string): Promise<void> {
    await query(
      `INSERT INTO processed_webhook_events (stripe_event_id, event_type)
       VALUES ($1, $2)
       ON CONFLICT (stripe_event_id) DO NOTHING`,
      [eventId, eventType]
    );
  }
}