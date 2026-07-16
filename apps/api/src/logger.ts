/**
 * PII-redacting structured logger. Emits one JSON object per line to CloudWatch with a stable
 * shape (level, msg, requestId, fields) and runs every field through `redactForLog` so owner
 * names / mailing addresses / contacts never reach the logs (design §8, §9). This is the only
 * logging surface the API uses.
 */
import { redactForLog } from "@oracle-duval/shared";

type Level = "info" | "warn" | "error";

export interface Logger {
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
  child(fields: Record<string, unknown>): Logger;
}

function emit(level: Level, requestId: string, base: Record<string, unknown>, msg: string, fields?: Record<string, unknown>) {
  const line = {
    level,
    ts: new Date().toISOString(),
    requestId,
    msg,
    ...redactForLog(base) as Record<string, unknown>,
    ...(fields ? (redactForLog(fields) as Record<string, unknown>) : {}),
  };
  const out = JSON.stringify(line);
  if (level === "error") console.error(out);
  else if (level === "warn") console.warn(out);
  else console.log(out);
}

export function createLogger(requestId: string, base: Record<string, unknown> = {}): Logger {
  return {
    info: (msg, fields) => emit("info", requestId, base, msg, fields),
    warn: (msg, fields) => emit("warn", requestId, base, msg, fields),
    error: (msg, fields) => emit("error", requestId, base, msg, fields),
    child: (extra) => createLogger(requestId, { ...base, ...extra }),
  };
}
