/**
 * Oracle Property Intelligence MCP Server.
 * T061 — MCP server using standard MCP SDK.
 *
 * Tools:
 *   - listOracleProperties: list available counties + IPNS pointers
 *   - queryProperties: execute DuckDB SQL against published Parquet
 *   - getPropertyDetail: lookup single property by parcel_id
 *
 * Transports:
 *   - stdio (default, for CLI / desktop MCP clients)
 *   - Lambda handler wrapper (for AWS Lambda deployment)
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import {
  loadIpnsMaps,
  listCounties,
  queryProperties,
  getPropertyDetail,
  type IpnsMapConfig,
} from './handlers/duval.js';

// ---------------------------------------------------------------------------
// Server factory
// ---------------------------------------------------------------------------

export function createMcpServer(config?: IpnsMapConfig): McpServer {
  const ipnsMaps = config ?? loadIpnsMaps();

  const server = new McpServer(
    {
      name: 'oracle-property-intelligence',
      version: '0.1.0',
    },
    {
      capabilities: {
        tools: {},
      },
      instructions:
        'Oracle Property Intelligence MCP server. Query Duval County property data ' +
        'published to IPFS/IPNS. All data is read from published artifacts — no hosted ' +
        'database required.',
    },
  );

  // -------------------------------------------------------------------------
  // Tool: listOracleProperties
  // -------------------------------------------------------------------------

  server.tool(
    'listOracleProperties',
    'List available counties and their IPNS pointers for published property data.',
    {},
    async () => {
      const counties = listCounties(ipnsMaps);

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(counties, null, 2),
          },
        ],
      };
    },
  );

  // -------------------------------------------------------------------------
  // Tool: queryProperties
  // -------------------------------------------------------------------------

  server.tool(
    'queryProperties',
    'Execute a SQL query against published Parquet property data for a county. ' +
      'The query runs via DuckDB httpfs over IPNS-resolved IPFS data. ' +
      'Use "properties" or "query_table" as the table name in your SQL.',
    {
      county: z
        .string()
        .describe('County name (e.g., "duval")'),
      sql: z
        .string()
        .describe(
          'SQL query to execute. Use "properties" as the table name. ' +
            'Example: SELECT parcel_id, address, assessed_value FROM properties WHERE assessed_value > 200000 LIMIT 10',
        ),
    },
    async ({ county, sql }) => {
      try {
        const rows = await queryProperties(ipnsMaps, county.toLowerCase(), sql);

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  county,
                  row_count: rows.length,
                  rows,
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ error: message }),
            },
          ],
          isError: true,
        };
      }
    },
  );

  // -------------------------------------------------------------------------
  // Tool: getPropertyDetail
  // -------------------------------------------------------------------------

  server.tool(
    'getPropertyDetail',
    'Look up a single property by parcel ID from published IPFS data.',
    {
      county: z
        .string()
        .describe('County name (e.g., "duval")'),
      parcel_id: z
        .string()
        .describe('Parcel ID / RE number to look up'),
    },
    async ({ county, parcel_id }) => {
      try {
        const property = await getPropertyDetail(
          ipnsMaps,
          county.toLowerCase(),
          parcel_id,
        );

        if (!property) {
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({
                  error: `Property not found: ${parcel_id} in ${county}`,
                }),
              },
            ],
            isError: true,
          };
        }

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(property, null, 2),
            },
          ],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ error: message }),
            },
          ],
          isError: true,
        };
      }
    },
  );

  return server;
}

// ---------------------------------------------------------------------------
// Stdio entrypoint (standalone mode)
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Log to stderr so it doesn't interfere with MCP stdio protocol
  process.stderr.write(
    'Oracle Property Intelligence MCP server started (stdio transport)\n',
  );
}

// Run if invoked directly
const isMainModule =
  typeof process !== 'undefined' &&
  process.argv[1] &&
  (process.argv[1].endsWith('/server.ts') ||
    process.argv[1].endsWith('/server.js'));

if (isMainModule) {
  main().catch((err) => {
    process.stderr.write(`Fatal error: ${err}\n`);
    process.exit(1);
  });
}

export default createMcpServer;
