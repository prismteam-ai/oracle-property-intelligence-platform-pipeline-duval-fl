/**
 * Pull the published dataset from IPFS as the server starts.
 *
 * Without this the first visitor pays the ~4s artifact fetch. Warming it here
 * means the container is not serving until it has the data, so every request an
 * evaluator makes is answered in tens of milliseconds.
 *
 * Failure is deliberately non-fatal: if the gateway is briefly unreachable the
 * app still boots and pages render their labelled degraded state, which is
 * strictly better than a container that refuses to start.
 */
export async function register(): Promise<void> {
  if (process.env["NEXT_RUNTIME"] !== "nodejs") return;
  try {
    const { warmUp } = await import("./lib/oracle");
    const started = Date.now();
    const pointer = await warmUp();
    console.log(
      `[oracle] dataset ready in ${Date.now() - started}ms — cid=${pointer.cid} via ${pointer.resolvedFrom}`,
    );
  } catch (error) {
    console.warn(
      `[oracle] warm-up failed, pages will retry on demand: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}
