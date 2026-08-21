/**
 * Local CLI to exercise the agent against live Neon/OpenSearch/Bedrock. Used to demonstrate the
 * six workflows and the DuckDB layer without the UI.
 *
 *   AWS_PROFILE=sandbox pnpm --filter @oracle-duval/agent ask "roofs older than 15 years"
 *   AWS_PROFILE=sandbox pnpm --filter @oracle-duval/agent ask --duckdb "select count(*) from properties where water_view"
 */
import { ask } from "./agent.ts";
import { duckdbQuery, duckdbAvailable } from "./tools/duckdb.ts";

async function main() {
  const args = process.argv.slice(2);
  if (args[0] === "--duckdb") {
    const sql = args.slice(1).join(" ");
    console.log("DuckDB available:", await duckdbAvailable());
    const res = await duckdbQuery(sql);
    console.log(JSON.stringify(res, null, 2));
    return;
  }
  const question = args.join(" ") || "Which properties have a roof older than 15 years?";
  const answer = await ask(question);
  console.log("\nQ:", question);
  console.log("\nANSWER:\n" + answer.answer);
  console.log("\nPATHS:", answer.paths.join(", "), "| MODEL:", answer.model);
  console.log("EVIDENCE (folios):", answer.evidence.map((e) => e.folio).join(", "));
  console.log("CITATIONS:", answer.citations.length);
  if (answer.notes) console.log("NOTE:", answer.notes);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
