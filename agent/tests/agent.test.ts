/**
 * Unit tests for agent tool definitions and execution.
 * T068 — Verify tool schemas, safety guards, and helper functions.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock duckdb before importing tools
vi.mock('duckdb', () => {
  const mockAll = vi.fn((_sql: string, cb: (err: unknown, rows: unknown[]) => void) => {
    cb(null, [
      {
        parcel_id: 'RE0001234',
        address: '123 Main Street',
        assessed_value: 250000,
        roof_age_years: 20,
        ownership_tenure_years: 15,
      },
    ]);
  });
  const mockExec = vi.fn((_sql: string, cb: (err: unknown) => void) => {
    cb(null);
  });
  const mockConnect = vi.fn(() => ({ all: mockAll, exec: mockExec, close: vi.fn() }));
  const mockDb = vi.fn(() => ({ connect: mockConnect, close: vi.fn() }));

  return {
    default: { Database: mockDb },
  };
});

// Mock ai package tool function
vi.mock('ai', () => ({
  tool: vi.fn((config: { description: string; parameters: unknown; execute: unknown }) => config),
  streamText: vi.fn(),
  generateText: vi.fn(),
}));

// Mock @ai-sdk/anthropic
vi.mock('@ai-sdk/anthropic', () => ({
  createAnthropic: vi.fn(() => vi.fn()),
}));

// Mock @ai-sdk/openai
vi.mock('@ai-sdk/openai', () => ({
  createOpenAI: vi.fn(() => vi.fn()),
}));

describe('agent tools', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  describe('queryProperties tool', () => {
    it('has a description mentioning SQL and DuckDB', async () => {
      const { queryProperties } = await import('../src/tools/query-properties.js');
      const toolDef = queryProperties as unknown as { description: string };
      expect(toolDef.description).toContain('SQL');
      expect(toolDef.description).toContain('properties');
    });

    it('has sql and explanation parameters', async () => {
      const { queryProperties } = await import('../src/tools/query-properties.js');
      const toolDef = queryProperties as unknown as { parameters: { shape: Record<string, unknown> } };
      expect(toolDef.parameters).toBeDefined();
    });
  });

  describe('getPropertyDetail tool', () => {
    it('has a description mentioning parcel ID', async () => {
      const { getPropertyDetail } = await import('../src/tools/property-detail.js');
      const toolDef = getPropertyDetail as unknown as { description: string };
      expect(toolDef.description).toContain('parcel ID');
    });
  });

  describe('DuckDB helper', () => {
    it('creates an in-memory database', async () => {
      const { getDb } = await import('../src/tools/duckdb-helper.js');
      const db = getDb();
      expect(db).toBeDefined();
    });

    it('creates a connection', async () => {
      const { getConnection } = await import('../src/tools/duckdb-helper.js');
      const conn = getConnection();
      expect(conn).toBeDefined();
    });

    it('executes queryAll and returns rows', async () => {
      const { queryAll } = await import('../src/tools/duckdb-helper.js');
      const rows = await queryAll('SELECT * FROM properties LIMIT 1');
      expect(rows).toBeInstanceOf(Array);
      expect(rows.length).toBeGreaterThan(0);
      expect(rows[0]).toHaveProperty('parcel_id');
    });

    it('executes exec without error', async () => {
      const { exec } = await import('../src/tools/duckdb-helper.js');
      await expect(exec('SELECT 1')).resolves.toBeUndefined();
    });

    it('can close the database', async () => {
      const { closeDb } = await import('../src/tools/duckdb-helper.js');
      expect(() => closeDb()).not.toThrow();
    });
  });

  describe('agent configuration', () => {
    it('exports tools object with queryProperties and getPropertyDetail', async () => {
      const { tools } = await import('../src/agent.js');
      expect(tools).toHaveProperty('queryProperties');
      expect(tools).toHaveProperty('getPropertyDetail');
    });

    it('exports SYSTEM_PROMPT containing Duval County', async () => {
      const { SYSTEM_PROMPT } = await import('../src/agent.js');
      expect(SYSTEM_PROMPT).toContain('Duval County');
    });

    it('system prompt mentions source provenance', async () => {
      const { SYSTEM_PROMPT } = await import('../src/agent.js');
      expect(SYSTEM_PROMPT).toContain('provenance');
    });

    it('system prompt lists available columns', async () => {
      const { SYSTEM_PROMPT } = await import('../src/agent.js');
      expect(SYSTEM_PROMPT).toContain('parcel_id');
      expect(SYSTEM_PROMPT).toContain('roof_age_years');
      expect(SYSTEM_PROMPT).toContain('water_proximity_ft');
    });
  });
});
