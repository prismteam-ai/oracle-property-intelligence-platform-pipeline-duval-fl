/** Pipeline-run summary, records-by-source overview, and the publication (IPFS/MCP) status. */
import { PUBLICATION } from "@oracle-duval/shared";
import { pipelineSummary, recordsBySource, contractors } from "@oracle-duval/agent";
import { protectedProcedure, router } from "../trpc.ts";

export const pipelineRouter = router({
  summary: protectedProcedure.query(async ({ ctx }) => {
    ctx.logger.info("pipeline.summary");
    return pipelineSummary();
  }),
  recordsBySource: protectedProcedure.query(async ({ ctx }) => {
    ctx.logger.info("pipeline.recordsBySource");
    return recordsBySource();
  }),
  contractors: protectedProcedure.query(async ({ ctx }) => {
    ctx.logger.info("pipeline.contractors");
    return contractors(20);
  }),
  publication: protectedProcedure.query(() => ({
    coverageCid: PUBLICATION.coverageCid,
    queryTableDryRunCid: PUBLICATION.queryTableDryRunCid,
    coverageGateway: PUBLICATION.coverageGateway,
    mcpEndpoint: PUBLICATION.mcpEndpoint,
    mcpHealth: PUBLICATION.mcpHealth,
    note:
      "Coverage snapshot is published to public IPFS (non-PII) and served by the MCP's " +
      "getOracleDatasetInfo. The per-property query table is dry-run only (carries owner PII) — its " +
      "CID is recorded but not uploaded. See docs/decisions/ipfs-publication.md.",
  })),
});
