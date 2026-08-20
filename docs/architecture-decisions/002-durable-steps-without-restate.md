# ADR 002 — Durable steps without Restate

## Status

Accepted.

## Context

`durable-workflow-builder` prescribes Restate for the pipeline's durability:
journaled steps, deterministic idempotency keys, single-writer virtual objects,
bounded windows, and resume-from-failure. Restate is a container plus a volume
plus an admin surface, running continuously.

ADR 001 removes always-on infrastructure from this design. Restate is the largest
remaining piece of it, and the evaluator never observes it — it is machinery
behind a pipeline whose output is a file on IPFS.

## Decision

Implement the durability _properties_ in-process against the DuckDB journal
rather than adopting the orchestrator that usually provides them.

| Property                       | Where it lives                                                                                             |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| Journaled steps                | `pipeline_run_steps`, one row per step per run, with status, timing, and the step's returned detail        |
| Deterministic idempotency keys | `<county>/<runId>/<stepKey>`, written on the step row                                                      |
| Skip-completed on re-entry     | `ctx.step()` returns early when the step already reached `success` or `skipped_unchanged`                  |
| Resume from failure            | `startRun({ resumeRunId })`, surfaced as `--resume`, re-adopts the newest non-terminal run                 |
| Single writer                  | one Railway replica, autoscaling off, because DuckDB is single-writer                                      |
| Bounded work                   | artifact-level ETag and release-watermark short-circuits, so an unchanged source costs one HEAD request    |
| Change history                 | `pipeline_run_deltas`, one row per changed record, which is also what the CRM's notification loop consumes |

## Consequences

- The durability guarantees are weaker than Restate's in one specific way: DuckDB
  statements here are autocommit, so a step that fails mid-apply can leave a
  partially applied table. The design compensates by making every apply
  idempotent and hash-gated — re-running converges — rather than by relying on a
  distributed transaction.
- Artifact fingerprints are committed only _after_ a load succeeds
  (`commitArtifact`), so a failed run cannot make the next run skip the source it
  never actually ingested.
- Anyone expecting the kit's Restate services will not find them. That is what
  this ADR is for.
