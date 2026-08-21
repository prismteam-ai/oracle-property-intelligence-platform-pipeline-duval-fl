/**
 * Bundle the tRPC Lambda for CDK. esbuild bundles the handler + the workspace packages to a single
 * CommonJS file; native/large deps are kept external and copied into the deployment node_modules:
 *   - @aws-sdk/*     provided by the Node.js 22 Lambda runtime (do not bundle)
 *   - @duckdb/*      native binding; copied verbatim (dereferenced) so the DuckDB layer runs in Lambda
 *   - pg-native      optional native driver we do not use
 * The non-PII query-table Parquet is copied alongside so the DuckDB view resolves at runtime.
 */
import { build } from "esbuild";
import { cpSync, mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const API = join(HERE, "..");
const DIST = join(API, "dist");

rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST, { recursive: true });

await build({
  entryPoints: [join(API, "src/handler.ts")],
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  outfile: join(DIST, "handler.mjs"),
  banner: { js: "import{createRequire as __cr}from'module';const require=__cr(import.meta.url);" },
  external: ["@aws-sdk/*", "@duckdb/node-api", "@duckdb/node-bindings", "@duckdb/node-bindings-linux-x64", "pg-native"],
  logLevel: "info",
  minify: false,
  sourcemap: false,
});

// dist is an ES module package.
writeFileSync(join(DIST, "package.json"), JSON.stringify({ type: "module" }, null, 2));

// Copy the DuckDB packages (dereference pnpm symlinks) so the external import resolves in Lambda.
// Resolve from the agent package (which declares @duckdb/*), not from apps/api.
const nm = join(DIST, "node_modules", "@duckdb");
mkdirSync(nm, { recursive: true });
// Resolve each package from the previous one's context (they are chained transitive deps).
let ctx = join(API, "..", "agent", "package.json");
for (const pkg of ["node-api", "node-bindings", "node-bindings-linux-x64"]) {
  const req = createRequire(ctx);
  const pkgJson = req.resolve(`@duckdb/${pkg}/package.json`);
  cpSync(dirname(pkgJson), join(nm, pkg), { recursive: true, dereference: true });
  ctx = pkgJson;
}

// Ship the non-PII query-table Parquet for the DuckDB view.
const parquet = join(API, "..", "agent", "data", "duval-query-table.parquet");
if (existsSync(parquet)) {
  mkdirSync(join(DIST, "data"), { recursive: true });
  cpSync(parquet, join(DIST, "data", "duval-query-table.parquet"));
}

console.log("bundle complete →", DIST);
