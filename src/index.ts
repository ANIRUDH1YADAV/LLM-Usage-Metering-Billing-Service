import express from 'express';
import { config } from './config/index.js';
import { pool, query } from './db/pool.js';
import { runMigrations } from './db/migrate.js';
import { cleanupJob } from './services/cleanup.js';
import { errorHandler, AuthenticatedRequest } from './middleware/auth.js';
import meterRoutes from './routes/meter.js';
import billingRoutes from './routes/billing.js';
import webhookRoutes from './routes/webhooks.js';

// Create Express app
const app = express();

// Raw body parser for Stripe webhooks (must be before express.json)
app.use('/webhooks/stripe', express.raw({ type: 'application/json' }));

// JSON parser for other routes
app.use(express.json());

// Attach db to app locals for routes that need direct access
app.locals.db = { query };

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API routes
app.use('/api/v1', meterRoutes);
app.use('/api/v1', billingRoutes);

// Webhook routes
app.use('/webhooks', webhookRoutes);

// 404 handler
app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Global error handler
app.use(errorHandler);

// Start server
async function start(): Promise<void> {
  try {
    // Run migrations
    await runMigrations();
    console.log('Database migrations completed');

    // Start cleanup job
    cleanupJob.start();
    console.log('Cleanup job started');

    // Start HTTP server
    const server = app.listen(config.port, () => {
      console.log(`Server running on http://localhost:${config.port}`);
      console.log(`Environment: ${config.nodeEnv}`);
    });

    // Graceful shutdown
    const shutdown = async (signal: string) => {
      console.log(`\n${signal} received, shutting down gracefully...`);
      cleanupJob.stop();
      server.close(async () => {
        await pool.end();
        console.log('Database pool closed');
        process.exit(0);
      });
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

start();