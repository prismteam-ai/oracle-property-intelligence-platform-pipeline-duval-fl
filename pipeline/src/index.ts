import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';

const app = new Hono();

// Middleware
app.use('*', logger());
app.use('/api/*', cors());

// Health check
app.get('/api/health', (c) => {
  return c.json({
    status: 'ok',
    service: 'oracle-pipeline-duval',
    timestamp: new Date().toISOString(),
    version: '0.1.0',
  });
});

// Placeholder routes — will be implemented in later phases
app.get('/api/runs', (c) => c.json({ runs: [], total: 0 }));
app.get('/api/runs/:id', (c) => c.json({ error: 'Not implemented' }, 501));
app.get('/api/sources', (c) => c.json({ sources: [] }));
app.get('/api/stats', (c) =>
  c.json({
    totalProperties: 0,
    lastRun: null,
    ipnsStatus: 'pending',
    sourceCount: 0,
  }),
);
app.post('/api/runs/trigger', (c) => c.json({ error: 'Not implemented' }, 501));

const port = parseInt(process.env.PORT || '9080', 10);

console.info(`Oracle Pipeline Duval — starting on port ${port}`);

serve({
  fetch: app.fetch,
  port,
});

export default app;
