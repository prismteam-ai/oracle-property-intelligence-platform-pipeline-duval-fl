/**
 * MCP test queries — validates MCP server tools via in-memory transport.
 * T063 — Run with `npm run mcp:test` from the mcp workspace.
 */

import { createMcpServer } from './server.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';

async function runTests(): Promise<void> {
  console.log('=== Oracle MCP Server Test Queries ===\n');

  // Create server with test IPNS maps if not set in env
  if (!process.env.ORACLE_OPEN_DATA_IPNS_MAP) {
    console.log(
      'No ORACLE_OPEN_DATA_IPNS_MAP set, using placeholder keys.\n' +
        'Set env vars to test against real published data.\n',
    );
  }

  const server = createMcpServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  const client = new Client({
    name: 'test-client',
    version: '0.1.0',
  });

  await Promise.all([
    client.connect(clientTransport),
    server.connect(serverTransport),
  ]);

  // Test 1: List tools
  console.log('--- Test 1: List available tools ---');
  const tools = await client.listTools();
  console.log(`Found ${tools.tools.length} tools:`);
  for (const tool of tools.tools) {
    console.log(`  - ${tool.name}: ${tool.description?.slice(0, 60)}...`);
  }
  console.log();

  // Test 2: listOracleProperties
  console.log('--- Test 2: listOracleProperties ---');
  const listResult = await client.callTool({ name: 'listOracleProperties' });
  console.log('Result:', JSON.stringify(listResult.content, null, 2).slice(0, 500));
  console.log();

  // Test 3: queryProperties (will fail without real IPNS data, but validates tool exists)
  console.log('--- Test 3: queryProperties ---');
  try {
    const queryResult = await client.callTool({
      name: 'queryProperties',
      arguments: {
        county: 'duval',
        sql: 'SELECT parcel_id, assessed_value FROM properties LIMIT 5',
      },
    });
    console.log('Result:', JSON.stringify(queryResult.content, null, 2).slice(0, 500));
  } catch (err) {
    console.log('Expected error (no live data):', err instanceof Error ? err.message : String(err));
  }
  console.log();

  // Test 4: getPropertyDetail (will fail without real IPNS data)
  console.log('--- Test 4: getPropertyDetail ---');
  try {
    const detailResult = await client.callTool({
      name: 'getPropertyDetail',
      arguments: {
        county: 'duval',
        parcel_id: '000000-0000',
      },
    });
    console.log('Result:', JSON.stringify(detailResult.content, null, 2).slice(0, 500));
  } catch (err) {
    console.log('Expected error (no live data):', err instanceof Error ? err.message : String(err));
  }
  console.log();

  await client.close();
  console.log('=== All tests completed ===');
}

runTests().catch((err) => {
  console.error('Test runner failed:', err);
  process.exit(1);
});
