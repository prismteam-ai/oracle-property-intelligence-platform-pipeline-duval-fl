export * from "./workflows.ts";
export * from "./redact.ts";
export * from "./types.ts";

/** IPFS / MCP publication identifiers exercised in Tasks 9-10 (dry-run + coverage). */
export const PUBLICATION = {
  /** Non-PII dataset-coverage snapshot — PUBLISHED to public IPFS, served by the MCP. */
  coverageCid: "QmRx1GjJGMTeoXzVz6gfhxty6yucj2aPZoN2a4CaYkDa5H",
  /** Per-property query-table — DRY-RUN only (carries owner PII; not uploaded). */
  queryTableDryRunCid: "QmY5RjCq1ZPfPSa9qfbmtn5uC2QYLYamKFse4NT8yE34Le",
  mcpEndpoint: "https://elephant-mcp-three.vercel.app/mcp",
  mcpHealth: "https://elephant-mcp-three.vercel.app/health",
  coverageGateway:
    "https://ipfs.filebase.io/ipfs/QmRx1GjJGMTeoXzVz6gfhxty6yucj2aPZoN2a4CaYkDa5H",
} as const;
