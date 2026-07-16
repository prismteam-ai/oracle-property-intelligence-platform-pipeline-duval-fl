/** Per-criterion query views — one procedure to run any of the six inquiry workflows. */
import { z } from "zod";
import { WORKFLOWS } from "@oracle-duval/shared";
import { runWorkflow } from "@oracle-duval/agent";
import { protectedProcedure, router } from "../trpc.ts";

const WorkflowIdSchema = z.enum([
  "roof_age",
  "water_view",
  "ownership_age",
  "regional_owner",
  "walking_distance",
  "records_by_source",
]);

export const workflowsRouter = router({
  list: protectedProcedure.query(() => WORKFLOWS),
  run: protectedProcedure
    .input(z.object({ id: WorkflowIdSchema, limit: z.number().int().min(1).max(200).default(50) }).strict())
    .query(async ({ input, ctx }) => {
      ctx.logger.info("workflows.run", { id: input.id, limit: input.limit });
      return runWorkflow(input.id, input.limit);
    }),
});
