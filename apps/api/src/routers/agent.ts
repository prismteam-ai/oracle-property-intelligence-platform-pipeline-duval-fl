/** The agent surface: natural-language ask (hybrid retrieval + SQL) and the DuckDB query layer. */
import { z } from "zod";
import { ask, duckdbQuery, duckdbAvailable } from "@oracle-duval/agent";
import { protectedProcedure, router } from "../trpc.ts";

export const agentRouter = router({
  ask: protectedProcedure
    .input(z.object({ question: z.string().min(3).max(500) }).strict())
    .mutation(async ({ input, ctx }) => {
      ctx.logger.info("agent.ask", { length: input.question.length });
      const answer = await ask(input.question);
      ctx.logger.info("agent.ask.done", { workflow: answer.workflow, paths: answer.paths, citations: answer.citations.length });
      return answer;
    }),
  duckdbStatus: protectedProcedure.query(async () => ({ available: await duckdbAvailable() })),
  duckdb: protectedProcedure
    .input(z.object({ sql: z.string().min(6).max(2000) }).strict())
    .mutation(async ({ input, ctx }) => {
      ctx.logger.info("agent.duckdb", { length: input.sql.length });
      return duckdbQuery(input.sql);
    }),
});
