import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { createApiRoutes } from './api/routes.js';
import { queryRoutes } from './api/query-routes.js';
import { agentRoutes } from './api/agent-routes.js';

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

// Pipeline API routes — runs, sources, stats, trigger (US3 — T047)
const apiRoutes = createApiRoutes();
app.route('/', apiRoutes);

// Property search and detail routes (US4 — T053)
app.route('/', queryRoutes);

// Agent chat routes (US4 — T058)
app.route('/', agentRoutes);

const port = parseInt(process.env.PORT || '9080', 10);

console.info(`Oracle Pipeline Duval — starting on port ${port}`);

serve({
  fetch: app.fetch,
  port,
});

export default app;
