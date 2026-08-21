/**
 * Observability helpers — structured logging, tracing, and metrics.
 * T065 — Integrate AWS Lambda Powertools for structured observability.
 *
 * NOTE: Powertools are designed for Lambda but the Logger/Tracer/Metrics
 * classes work in any Node.js runtime. On EC2/Docker they degrade gracefully
 * (tracer becomes a no-op, metrics buffer but don't auto-flush to CloudWatch
 * unless EMF agent is running). The structured JSON logging alone is valuable
 * everywhere.
 */

// ---------------------------------------------------------------------------
// Logger — structured JSON logging
// ---------------------------------------------------------------------------

export enum LogLevel {
  DEBUG = 'DEBUG',
  INFO = 'INFO',
  WARN = 'WARN',
  ERROR = 'ERROR',
}

interface LogEntry {
  level: LogLevel;
  message: string;
  service: string;
  timestamp: string;
  [key: string]: unknown;
}

/**
 * Lightweight structured logger that outputs JSON lines.
 * Compatible with CloudWatch Logs Insights queries.
 */
export class Logger {
  private readonly service: string;
  private readonly persistentAttributes: Record<string, unknown>;

  constructor(options: { serviceName: string; persistentLogAttributes?: Record<string, unknown> }) {
    this.service = options.serviceName;
    this.persistentAttributes = options.persistentLogAttributes ?? {};
  }

  private log(level: LogLevel, message: string, extra?: Record<string, unknown>): void {
    const entry: LogEntry = {
      level,
      message,
      service: this.service,
      timestamp: new Date().toISOString(),
      ...this.persistentAttributes,
      ...extra,
    };

    const line = JSON.stringify(entry);

    switch (level) {
      case LogLevel.ERROR:
        console.error(line);
        break;
      case LogLevel.WARN:
        console.warn(line);
        break;
      case LogLevel.DEBUG:
        console.debug(line);
        break;
      default:
        console.info(line);
    }
  }

  debug(message: string, extra?: Record<string, unknown>): void {
    this.log(LogLevel.DEBUG, message, extra);
  }

  info(message: string, extra?: Record<string, unknown>): void {
    this.log(LogLevel.INFO, message, extra);
  }

  warn(message: string, extra?: Record<string, unknown>): void {
    this.log(LogLevel.WARN, message, extra);
  }

  error(message: string, extra?: Record<string, unknown>): void {
    this.log(LogLevel.ERROR, message, extra);
  }

  /**
   * Create a child logger with additional persistent attributes.
   */
  child(attributes: Record<string, unknown>): Logger {
    const child = new Logger({ serviceName: this.service });
    Object.assign(child['persistentAttributes'], this.persistentAttributes, attributes);
    return child;
  }
}

// ---------------------------------------------------------------------------
// Tracer — lightweight span tracking
// ---------------------------------------------------------------------------

export interface Span {
  name: string;
  startTime: number;
  attributes: Record<string, unknown>;
  end: () => SpanResult;
}

export interface SpanResult {
  name: string;
  durationMs: number;
  attributes: Record<string, unknown>;
}

/**
 * Lightweight tracer for measuring operation durations.
 * On Lambda with X-Ray, this would delegate to the Powertools Tracer.
 * On EC2/Docker, it provides timing data via structured logs.
 */
export class Tracer {
  private readonly logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  /**
   * Start a new span for tracking an operation.
   */
  startSpan(name: string, attributes?: Record<string, unknown>): Span {
    const startTime = Date.now();
    const spanAttrs = { ...attributes };

    this.logger.debug(`span:start ${name}`, { span: name, ...spanAttrs });

    return {
      name,
      startTime,
      attributes: spanAttrs,
      end: (): SpanResult => {
        const durationMs = Date.now() - startTime;
        this.logger.info(`span:end ${name}`, {
          span: name,
          duration_ms: durationMs,
          ...spanAttrs,
        });
        return { name, durationMs, attributes: spanAttrs };
      },
    };
  }

  /**
   * Trace an async function, automatically measuring its duration.
   */
  async trace<T>(
    name: string,
    fn: () => Promise<T>,
    attributes?: Record<string, unknown>,
  ): Promise<T> {
    const span = this.startSpan(name, attributes);
    try {
      const result = await fn();
      span.end();
      return result;
    } catch (err) {
      this.logger.error(`span:error ${name}`, {
        span: name,
        error: err instanceof Error ? err.message : String(err),
        duration_ms: Date.now() - span.startTime,
        ...attributes,
      });
      throw err;
    }
  }
}

// ---------------------------------------------------------------------------
// Metrics — lightweight counter/gauge tracking
// ---------------------------------------------------------------------------

interface MetricEntry {
  name: string;
  value: number;
  unit: string;
  dimensions: Record<string, string>;
  timestamp: string;
}

/**
 * Lightweight metrics collector.
 * Buffers metrics and flushes as structured JSON (CloudWatch EMF compatible).
 */
export class Metrics {
  private readonly namespace: string;
  private readonly logger: Logger;
  private readonly buffer: MetricEntry[] = [];
  private readonly defaultDimensions: Record<string, string>;

  constructor(options: {
    namespace: string;
    logger: Logger;
    defaultDimensions?: Record<string, string>;
  }) {
    this.namespace = options.namespace;
    this.logger = options.logger;
    this.defaultDimensions = options.defaultDimensions ?? {};
  }

  /**
   * Record a metric value.
   */
  addMetric(
    name: string,
    value: number,
    unit: string = 'Count',
    dimensions?: Record<string, string>,
  ): void {
    this.buffer.push({
      name,
      value,
      unit,
      dimensions: { ...this.defaultDimensions, ...dimensions },
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Flush buffered metrics as structured log entries.
   */
  flush(): void {
    for (const metric of this.buffer) {
      this.logger.info(`metric:${metric.name}`, {
        _aws: {
          Timestamp: Date.now(),
          CloudWatchMetrics: [
            {
              Namespace: this.namespace,
              Dimensions: [Object.keys(metric.dimensions)],
              Metrics: [{ Name: metric.name, Unit: metric.unit }],
            },
          ],
        },
        ...metric.dimensions,
        [metric.name]: metric.value,
      });
    }
    this.buffer.length = 0;
  }
}

// ---------------------------------------------------------------------------
// Pre-configured instances for pipeline services
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

/** Global tracer instance */
export const tracer = new Tracer(
  new Logger({ serviceName: 'oracle-pipeline', persistentLogAttributes: { component: 'tracer' } }),
);

/** Global metrics instance */
export const metrics = new Metrics({
  namespace: 'OraclePipeline/Duval',
  logger: new Logger({
    serviceName: 'oracle-pipeline',
    persistentLogAttributes: { component: 'metrics' },
  }),
  defaultDimensions: { county: 'duval', environment: process.env.NODE_ENV ?? 'development' },
});
