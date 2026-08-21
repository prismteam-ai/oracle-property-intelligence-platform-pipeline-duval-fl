/**
 * Backpressure feeder for chunked parcel processing.
 * T035 — Configurable batch size, concurrency limits, progress tracking
 * for full county ingestion.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FeederConfig {
  /** Number of items per batch. Default: 50. */
  batchSize: number;
  /** Maximum number of concurrent batches. Default: 3. */
  concurrency: number;
  /** Delay between batches in ms. Default: 100. */
  delayBetweenBatchesMs: number;
  /** Optional callback for progress tracking. */
  onProgress?: (progress: FeederProgress) => void;
  /** Optional abort signal. */
  signal?: AbortSignal;
}

export interface FeederProgress {
  /** Total items to process. */
  total: number;
  /** Items processed so far. */
  processed: number;
  /** Items that failed. */
  failed: number;
  /** Current batch number. */
  currentBatch: number;
  /** Total number of batches. */
  totalBatches: number;
  /** Percentage complete (0-100). */
  percentComplete: number;
  /** Estimated time remaining in ms. */
  estimatedRemainingMs: number | null;
  /** Start time. */
  startedAt: Date;
  /** Elapsed time in ms. */
  elapsedMs: number;
}

export interface FeederResult<T> {
  /** Successfully processed results. */
  results: T[];
  /** Total items processed. */
  totalProcessed: number;
  /** Items that failed. */
  totalFailed: number;
  /** Total batches. */
  totalBatches: number;
  /** Total duration in ms. */
  durationMs: number;
}

// ---------------------------------------------------------------------------
// Default config
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: FeederConfig = {
  batchSize: 50,
  concurrency: 3,
  delayBetweenBatchesMs: 100,
};

// ---------------------------------------------------------------------------
// Feeder implementation
// ---------------------------------------------------------------------------

/**
 * Sleep for a given number of milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Split an array into chunks of a given size.
 */
function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

/**
 * Process items with backpressure control.
 * Splits items into batches and processes up to `concurrency` batches at a time.
 *
 * @param items - Items to process.
 * @param processBatch - Function that processes a batch and returns results.
 * @param config - Feeder configuration.
 * @returns Aggregated results from all batches.
 */
export async function feed<TItem, TResult>(
  items: TItem[],
  processBatch: (batch: TItem[], batchIndex: number) => Promise<TResult[]>,
  config?: Partial<FeederConfig>,
): Promise<FeederResult<TResult>> {
  const cfg: FeederConfig = { ...DEFAULT_CONFIG, ...config };
  const batches = chunk(items, cfg.batchSize);
  const totalBatches = batches.length;
  const startedAt = new Date();
  const results: TResult[] = [];
  let processed = 0;
  let failed = 0;

  console.info(
    `[feeder] Starting: ${items.length} items, ${totalBatches} batches (size=${cfg.batchSize}, concurrency=${cfg.concurrency})`,
  );

  // Process batches with concurrency control
  for (let i = 0; i < totalBatches; i += cfg.concurrency) {
    // Check abort signal
    if (cfg.signal?.aborted) {
      console.warn(`[feeder] Aborted at batch ${i}/${totalBatches}`);
      break;
    }

    const concurrentBatches = batches.slice(i, i + cfg.concurrency);
    const batchPromises = concurrentBatches.map(async (batch, offset) => {
      const batchIndex = i + offset;
      try {
        const batchResults = await processBatch(batch, batchIndex);
        return { results: batchResults, failed: 0 };
      } catch (err) {
        console.error(`[feeder] Batch ${batchIndex} failed:`, err);
        return { results: [] as TResult[], failed: batch.length };
      }
    });

    const batchOutcomes = await Promise.all(batchPromises);

    for (const outcome of batchOutcomes) {
      results.push(...outcome.results);
      processed += outcome.results.length + outcome.failed;
      failed += outcome.failed;
    }

    // Report progress
    const elapsedMs = Date.now() - startedAt.getTime();
    const batchesDone = Math.min(i + cfg.concurrency, totalBatches);
    const avgBatchTime = elapsedMs / batchesDone;
    const remainingBatches = totalBatches - batchesDone;

    const progress: FeederProgress = {
      total: items.length,
      processed,
      failed,
      currentBatch: batchesDone,
      totalBatches,
      percentComplete: Math.round((batchesDone / totalBatches) * 100),
      estimatedRemainingMs: remainingBatches > 0 ? Math.round(avgBatchTime * remainingBatches) : 0,
      startedAt,
      elapsedMs,
    };

    cfg.onProgress?.(progress);

    if (batchesDone < totalBatches) {
      console.info(
        `[feeder] Progress: ${progress.percentComplete}% (${batchesDone}/${totalBatches} batches, ` +
          `${processed} items, ETA: ${Math.round((progress.estimatedRemainingMs ?? 0) / 1000)}s)`,
      );
    }

    // Delay between batch groups for backpressure
    if (cfg.delayBetweenBatchesMs > 0 && batchesDone < totalBatches) {
      await sleep(cfg.delayBetweenBatchesMs);
    }
  }

  const durationMs = Date.now() - startedAt.getTime();

  console.info(
    `[feeder] Complete: ${results.length} results, ${failed} failed, ${totalBatches} batches, ${durationMs}ms`,
  );

  return {
    results,
    totalProcessed: processed,
    totalFailed: failed,
    totalBatches,
    durationMs,
  };
}

/**
 * Create a pre-configured feeder instance.
 * Useful when you want to set config once and feed multiple times.
 */
export function createFeeder(config?: Partial<FeederConfig>) {
  const cfg: FeederConfig = { ...DEFAULT_CONFIG, ...config };

  return {
    config: cfg,
    feed: <TItem, TResult>(
      items: TItem[],
      processBatch: (batch: TItem[], batchIndex: number) => Promise<TResult[]>,
    ) => feed(items, processBatch, cfg),
  };
}
