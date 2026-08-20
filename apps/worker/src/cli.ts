import { deriveQueryTable } from "./derive.ts";
import {
  finishRun,
  findResumableRun,
  startRun,
  type RunMode,
  type RunTrigger,
} from "./runner.ts";
import { ingestNal, ingestSdf } from "./sources/fldor.ts";
import { ingestPlaces, ingestWater } from "./sources/overture.ts";
import { ingestParcelPoints } from "./sources/parcel-points.ts";
import { close, migrate, query } from "./warehouse.ts";

/**
 * Pipeline entry point.
 *
 *   pnpm run:pipeline --mode backfill    --roll 2026P --vintage 2026F
 *   pnpm run:pipeline --mode incremental --roll 2026P --vintage 2026F
 *   pnpm run:pipeline --resume
 *
 * Every source step short-circuits before doing work when its upstream input is
 * unchanged: the three Florida DOR files compare the HTTP ETag and content
 * length recorded at the last *successful* load, and the two Overture steps
 * compare the release identifier. A re-run against unchanged inputs therefore
 * touches no rows and records zero deltas — that no-op run is the pipeline's
 * idempotency evidence rather than a claim about it.
 *
 * `--resume` re-adopts the most recent run that did not reach a terminal state
 * and continues at its first incomplete step.
 */

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? fallback) : fallback;
}
function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

export async function runPipeline(opts: {
  mode: RunMode;
  trigger: RunTrigger;
  roll: string;
  vintage: string;
  resumeRunId?: string;
}): Promise<string> {
  await migrate();
  const ctx = await startRun({
    mode: opts.mode,
    trigger: opts.trigger,
    resumeRunId: opts.resumeRunId,
  });
  console.log(
    `[${ctx.runId}] mode=${opts.mode} roll=${opts.roll} vintage=${opts.vintage}` +
      (opts.resumeRunId ? " (resumed)" : ""),
  );

  try {
    const nal = await ctx.step("fl_dor_nal", (c) =>
      ingestNal(c, { year: opts.roll }),
    );
    console.log(`  nal: ${JSON.stringify(nal ?? "already complete")}`);

    const sdf = await ctx.step("fl_dor_sdf", (c) =>
      ingestSdf(c, { year: opts.roll }),
    );
    console.log(`  sdf: ${JSON.stringify(sdf ?? "already complete")}`);

    const pin = await ctx.step("fl_dor_parcel_geometry", (c) =>
      ingestParcelPoints(c, { vintage: opts.vintage }),
    );
    console.log(`  geometry: ${JSON.stringify(pin ?? "already complete")}`);

    const places = await ctx.step("overture_places", (c) => ingestPlaces(c));
    console.log(`  places: ${JSON.stringify(places ?? "already complete")}`);

    const water = await ctx.step("overture_water", (c) => ingestWater(c));
    console.log(`  water: ${JSON.stringify(water ?? "already complete")}`);

    const derived = await ctx.step("derive_query_table", (c) =>
      deriveQueryTable(c),
    );
    console.log(`  derive: ${JSON.stringify(derived ?? "already complete")}`);

    await finishRun(ctx, "success");
  } catch (error) {
    await finishRun(ctx, "failed");
    throw error;
  }
  return ctx.runId;
}

const isEntry = process.argv[1]?.endsWith("cli.ts");
if (isEntry) {
  const mode = arg("mode", "incremental") as RunMode;
  const roll = arg("roll", "2026P");
  const vintage = arg("vintage", "2026F");

  const main = async () => {
    await migrate();
    const resumeRunId = flag("resume") ? await findResumableRun() : undefined;
    if (flag("resume") && !resumeRunId) {
      console.log("Nothing to resume — no run is in a non-terminal state.");
      return;
    }
    const runId = await runPipeline({
      mode,
      trigger: "manual",
      roll,
      vintage,
      resumeRunId,
    });
    const rows = await query(
      `SELECT run_id, mode, status, records_in, inserts, updates, deletes, unchanged, duration_ms
         FROM pipeline_runs WHERE run_id = '${runId}'`,
    );
    console.log("\nRun summary:", rows[0]);
    const counts = await query(
      `SELECT (SELECT count(*) FROM parcels)       AS parcels,
              (SELECT count(*) FROM sales)         AS sales,
              (SELECT count(*) FROM parcel_points) AS geometries,
              (SELECT count(*) FROM places)        AS places`,
    );
    console.log("Warehouse:", counts[0]);
  };

  main()
    .then(() => close())
    .catch(async (error) => {
      console.error("Pipeline failed:", error);
      await close();
      process.exit(1);
    });
}
