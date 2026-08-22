/**
 * Lambda handler wrapper for the MCP server.
 * T064 — Wraps the MCP server for AWS Lambda deployment.
 *
 * Accepts JSON-RPC requests via API Gateway and returns JSON-RPC responses.
 * Actual Lambda deployment is deferred — this provides the handler code.
 */

import { createMcpServer } from './server.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';

// ---------------------------------------------------------------------------
// Types for Lambda events (minimal, avoids aws-lambda dependency)
// ---------------------------------------------------------------------------

interface ApiGatewayEvent {
  httpMethod: string;
  path: string;
  body: string | null;
  headers: Record<string, string>;
  requestContext?: Record<string, unknown>;
}

interface LambdaResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

// ---------------------------------------------------------------------------
// Lambda handler
// ---------------------------------------------------------------------------

/**
 * AWS Lambda handler for the MCP server.
 * Receives JSON-RPC messages via HTTP POST, processes them through
 * the MCP server, and returns JSON-RPC responses.
 */
export async function handler(event: ApiGatewayEvent): Promise<LambdaResponse> {
  const corsHeaders = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: corsHeaders,
      body: '',
    };
  }

  // Health check on GET
  if (event.httpMethod === 'GET') {
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        status: 'healthy',
        server: 'oracle-property-intelligence-mcp',
        version: '0.1.0',
      }),
    };
  }

  // Only accept POST for JSON-RPC
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  if (!event.body) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Request body is required' }),
    };
  }

  try {
    // Create a fresh server + in-memory client for each request
    const mcpServer = createMcpServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    const client = new Client({
      name: 'lambda-proxy',
      version: '0.1.0',
    });

    // Connect both sides
    await Promise.all([
      client.connect(clientTransport),
      mcpServer.connect(serverTransport),
    ]);

    // Parse the incoming JSON-RPC request
    const request = JSON.parse(event.body);

    // Route based on the JSON-RPC method
    let result: unknown;

    if (request.method === 'tools/list') {
      result = await client.listTools();
    } else if (request.method === 'tools/call') {
      result = await client.callTool(request.params);
    } else if (request.method === 'initialize') {
      // Already initialized via connect
      result = {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'oracle-property-intelligence', version: '0.1.0' },
      };
    } else {
      await client.close();
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({
          jsonrpc: '2.0',
          error: { code: -32601, message: `Method not found: ${request.method}` },
          id: request.id ?? null,
        }),
      };
    }

    await client.close();

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        jsonrpc: '2.0',
        result,
        id: request.id ?? null,
      }),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({
        jsonrpc: '2.0',
        error: { code: -32603, message },
        id: null,
      }),
    };
  }
}

export default handler;
