import { Router, Request, Response } from 'express';
import { StripeService } from '../services/stripe.js';
import Stripe from 'stripe';

const router = Router();

/**
 * POST /webhooks/stripe
 * Handle Stripe webhook events
 */
router.post(
  '/stripe',
  // Use raw body for signature verification
  async (req: Request, res: Response): Promise<void> => {
    const signature = req.headers['stripe-signature'] as string;

    if (!signature) {
      res.status(400).json({ error: 'Missing stripe-signature header' });
      return;
    }

    let event: Stripe.Event;

    try {
      // Verify webhook signature
      event = StripeService.verifyWebhookSignature(req.body, signature);
    } catch (error) {
      console.error('Webhook signature verification failed:', error);
      res.status(400).json({ error: 'Invalid webhook signature' });
      return;
    }

    // Check for duplicate event processing
    const alreadyProcessed = await StripeService.isEventProcessed(event.id);
    if (alreadyProcessed) {
      console.log(`Duplicate webhook event ignored: ${event.id} (${event.type})`);
      res.json({ received: true, duplicate: true });
      return;
    }

    try {
      switch (event.type) {
        case 'checkout.session.completed': {
          const session = event.data.object as Stripe.Checkout.Session;
          await StripeService.handleCheckoutCompleted(session);
          break;
        }
        case 'customer.subscription.updated': {
          const subscription = event.data.object as Stripe.Subscription;
          await StripeService.handleSubscriptionUpdated(subscription);
          break;
        }
        case 'customer.subscription.deleted': {
          const subscription = event.data.object as Stripe.Subscription;
          await StripeService.handleSubscriptionDeleted(subscription);
          break;
        }
        default:
          console.log(`Unhandled webhook event type: ${event.type}`);
      }

      // Mark event as processed
      await StripeService.markEventProcessed(event.id, event.type);

      res.json({ received: true });
    } catch (error) {
      console.error('Webhook processing failed:', error);
      // Don't mark as processed so Stripe will retry
      res.status(500).json({ error: 'Webhook processing failed' });
    }
  }
);

export default router;