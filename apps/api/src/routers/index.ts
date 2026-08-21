/** Root tRPC router. `health` is public (smoke checks); every data procedure is behind auth. */
import { publicProcedure, router } from "../trpc.ts";
import { pipelineRouter } from "./pipeline.ts";
import { workflowsRouter } from "./workflows.ts";
import { entitiesRouter } from "./entities.ts";
import { agentRouter } from "./agent.ts";

export const appRouter = router({
  health: publicProcedure.query(() => ({ status: "ok", service: "oracle-duval-api", county: "duval" })),
  pipeline: pipelineRouter,
  workflows: workflowsRouter,
  entities: entitiesRouter,
  agent: agentRouter,
});

export type AppRouter = typeof appRouter;
