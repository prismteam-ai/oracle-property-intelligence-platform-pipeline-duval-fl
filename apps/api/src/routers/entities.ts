/** Entity / relationship exploration — one parcel's reconciled entities (no owner PII). */
import { z } from "zod";
import { exploreProperty } from "@oracle-duval/agent";
import { protectedProcedure, router } from "../trpc.ts";

export const entitiesRouter = router({
  explore: protectedProcedure
    .input(z.object({ folio: z.string().min(1).max(32) }).strict())
    .query(async ({ input, ctx }) => {
      ctx.logger.info("entities.explore", { folio: input.folio });
      const result = await exploreProperty(input.folio.trim());
      return { found: result != null, property: result };
    }),
});
