import express from 'express';
import { createServer as createViteServer } from 'vite';
import dotenv from 'dotenv';
import { agentRouter } from './src/api/agent.ts';

dotenv.config();

const app = express();
app.use(express.json({ limit: '10mb' }));

// Mount Agent API routes under /api
app.use('/api', agentRouter);

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ ok: true, timestamp: new Date().toISOString() });
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
