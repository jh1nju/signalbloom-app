import express from 'express';
import { createServer as createViteServer } from 'vite';
import dotenv from 'dotenv';
import { agentRouter } from './src/api/agent.ts';
import { appShellRouter } from './src/api/appShell.ts';
import { healthRouter } from './src/api/health.ts';

dotenv.config();

const app = express();
app.use(express.json({ limit: '10mb' }));

// Mount API routes
app.use('/api', agentRouter);
app.use('/api', appShellRouter);
app.use('/api', healthRouter);

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ ok: true, timestamp: new Date().toISOString() });
});

// Serve public static assets
app.use(express.static('public'));
app.get('/favicon.ico', (req, res) => {
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
});
