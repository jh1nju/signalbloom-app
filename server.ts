import express from 'express';
import { createServer as createViteServer } from 'vite';
import dotenv from 'dotenv';
import { agentRouter } from './src/api/agent.ts';
import { appShellRouter } from './src/api/appShell.ts';
import { healthRouter } from './src/api/health.ts';
import { devicesRouter } from './src/api/devices.ts';
import { alertsRouter } from './src/api/alerts.ts';
import { devRouter } from './src/api/dev.ts';
import { evaluateAlertsForAllSites, runDevSampleTick } from './src/services/alertEngine.ts';

dotenv.config();

const app = express();
app.use(express.json({ limit: '10mb' }));

// Mount API routes
app.use('/api', agentRouter);
app.use('/api', appShellRouter);
app.use('/api', healthRouter);
app.use('/api', devicesRouter);
app.use('/api', alertsRouter);

// Mount /api/dev/* ONLY when NODE_ENV is not production
if (process.env.NODE_ENV !== 'production') {
  app.use('/api/dev', devRouter);
}

// Health check endpoint
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, timestamp: new Date().toISOString() });
});

// Return 404 for any unmatched /api/* routes (including /api/dev/* in production)
app.use('/api', (_req, res) => {
  res.status(404).json({
    error: {
      code: 'not_found',
      message: 'API route not found.',
    },
  });
});

// Serve public static assets
app.use(express.static('public'));
app.get('/favicon.ico', (_req, res) => {
  res.redirect(301, '/assets/aistudio/signalbloom-logo_af397f27.png');
});

// Mount Vite middleware for dev server
if (process.env.NODE_ENV !== 'production') {
  const vite = await createViteServer({
    server: {
      middlewareMode: true,
      hmr: process.env.DISABLE_HMR !== 'true',
    },
    appType: 'spa',
  });
  app.use(vite.middlewares);
} else {
  app.use(express.static('dist'));
}

const PORT = Number(process.env.PORT) || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`SignalBloom server listening on http://0.0.0.0:${PORT}`);

  // Initial evaluation of alerts
  void (async () => {
    if (process.env.NODE_ENV !== 'production') {
      await runDevSampleTick();
    }
    await evaluateAlertsForAllSites();
  })();

  // Every 30 seconds: (in dev) add sample reading if sample_data is true, then evaluate alert rules
  setInterval(async () => {
    if (process.env.NODE_ENV !== 'production') {
      await runDevSampleTick();
    }
    await evaluateAlertsForAllSites();
  }, 30000);
});
