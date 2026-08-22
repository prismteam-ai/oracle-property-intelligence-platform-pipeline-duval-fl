/**
 * Observability helpers — structured logging, tracing, and metrics.
 * Uses AWS Lambda Powertools for structured observability.
 *
 * NOTE: Powertools are designed for Lambda but the Logger/Tracer/Metrics
 * classes work in any Node.js runtime. On EC2/Docker they degrade gracefully
 * (tracer becomes a no-op, metrics buffer but don't auto-flush to CloudWatch
 * unless EMF agent is running). The structured JSON logging alone is valuable
 * everywhere.
 */

import { Logger } from '@aws-lambda-powertools/logger';
import { Tracer } from '@aws-lambda-powertools/tracer';
import { Metrics, MetricUnit } from '@aws-lambda-powertools/metrics';

// Re-export Powertools classes for convenience
export { Logger, Tracer, Metrics, MetricUnit };

// ---------------------------------------------------------------------------
// Pre-configured Logger instances for pipeline components
// ---------------------------------------------------------------------------

/** Logger for the county-ingest workflow */
export const ingestLogger = new Logger({
  serviceName: 'oracle-pipeline',
  persistentLogAttributes: { component: 'county-ingest' },
});

/** Logger for source adapters */
export const sourceLogger = new Logger({
  serviceName: 'oracle-pipeline',
  persistentLogAttributes: { component: 'source-adapter' },
});

/** Logger for publish workflows */
export const publishLogger = new Logger({
  serviceName: 'oracle-pipeline',
  persistentLogAttributes: { component: 'publish' },
});

/** Logger for webhook service */
export const webhookLogger = new Logger({
  serviceName: 'oracle-pipeline',
  persistentLogAttributes: { component: 'webhook' },
});

/** Logger for the loader service */
export const loaderLogger = new Logger({
  serviceName: 'oracle-pipeline',
  persistentLogAttributes: { component: 'loader' },
});

/** Logger for the parcel reconciliation service */
export const parcelLogger = new Logger({
  serviceName: 'oracle-pipeline',
  persistentLogAttributes: { component: 'parcel' },
});

/** Logger for the API server */
export const apiLogger = new Logger({
  serviceName: 'oracle-pipeline',
  persistentLogAttributes: { component: 'api' },
});

// ---------------------------------------------------------------------------
// Pre-configured Tracer instance
// ---------------------------------------------------------------------------

/** Global tracer instance */
export const tracer = new Tracer({
  serviceName: 'oracle-pipeline',
});

// ---------------------------------------------------------------------------
// Pre-configured Metrics instance
// ---------------------------------------------------------------------------

/** Global metrics instance */
export const metrics = new Metrics({
  namespace: 'OraclePipeline/Duval',
  serviceName: 'oracle-pipeline',
  defaultDimensions: {
    county: 'duval',
    environment: process.env.NODE_ENV ?? 'development',
  },
});
