/**
 * tRPC initialisation. The error formatter strips stack traces (they leak source paths) — a
 * lesson carried from prior deploys. `protectedProcedure` enforces the bearer-token auth so the
 * Neon-backed data procedures are only reachable behind auth.
 */
import { initTRPC, TRPCError } from "@trpc/server";
import { ZodError } from "zod";
import type { Context } from "./context.ts";

const t = initTRPC.context<Context>().create({
  errorFormatter({ shape, error }) {
    return {
      ...shape,
      data: {
        code: shape.data.code,
        httpStatus: shape.data.httpStatus,
        // Deliberately omit `stack` and `path` internals.
        zod: error.cause instanceof ZodError ? error.cause.flatten() : undefined,
      },
    };
  },
});

export const router = t.router;
export const publicProcedure = t.procedure;

const enforceAuth = t.middleware(({ ctx, next }) => {
  if (!ctx.authed) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Valid access token required." });
  }
  return next({ ctx });
});

export const protectedProcedure = t.procedure.use(enforceAuth);
