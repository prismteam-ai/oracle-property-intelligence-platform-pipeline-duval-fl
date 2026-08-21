/**
 * Unit tests for Filebase helpers.
 * T068 — Verify CID computation, bucket name resolution, and URL builders.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock @aws-sdk/client-s3 before importing filebase
vi.mock('@aws-sdk/client-s3', () => {
  const mockSend = vi.fn().mockResolvedValue({
    Metadata: { cid: 'QmTestCid123' },
  });

  return {
    S3Client: vi.fn().mockImplementation(() => ({ send: mockSend })),
    PutObjectCommand: vi.fn(),
    HeadObjectCommand: vi.fn(),
  };
});

// Mock ipfs-only-hash
vi.mock('ipfs-only-hash', () => ({
  of: vi.fn().mockResolvedValue('QmComputedCid456'),
}));

describe('filebase', () => {
  beforeEach(() => {
    vi.resetModules();
    // Set env vars for tests
    process.env.FILEBASE_ACCESS_KEY = 'test-key';
    process.env.FILEBASE_SECRET_KEY = 'test-secret';
  });

  describe('bucket names', () => {
    it('returns default open data bucket', async () => {
      delete process.env.FILEBASE_BUCKET_OPEN_DATA;
      const { openDataBucket } = await import('../../src/lib/filebase.js');
      expect(openDataBucket()).toBe('elephant-oracle-open-data-duval');
    });

    it('returns env-configured open data bucket', async () => {
      process.env.FILEBASE_BUCKET_OPEN_DATA = 'custom-bucket';
      const { openDataBucket } = await import('../../src/lib/filebase.js');
      expect(openDataBucket()).toBe('custom-bucket');
    });

    it('returns default query table bucket', async () => {
      delete process.env.FILEBASE_BUCKET_QUERY_TABLE;
      const { queryTableBucket } = await import('../../src/lib/filebase.js');
      expect(queryTableBucket()).toBe('elephant-oracle-query-table-duval');
    });
  });

  describe('URL builders', () => {
    it('builds IPFS gateway URL', async () => {
      const { ipfsGatewayUrl } = await import('../../src/lib/filebase.js');
      expect(ipfsGatewayUrl('QmTestCid')).toBe('https://ipfs.filebase.io/ipfs/QmTestCid');
    });

    it('builds IPNS gateway URL', async () => {
      const { ipnsGatewayUrl } = await import('../../src/lib/filebase.js');
      expect(ipnsGatewayUrl('k51testkey')).toBe('https://ipfs.filebase.io/ipns/k51testkey');
    });
  });

  describe('computeCid', () => {
    it('computes CID from buffer data', async () => {
      const { computeCid } = await import('../../src/lib/filebase.js');
      const data = Buffer.from('{"test": "data"}');
      const cid = await computeCid(data);
      expect(cid).toBe('QmComputedCid456');
    });
  });

  describe('uploadJson', () => {
    it('uploads JSON and returns result with CID', async () => {
      const { uploadJson } = await import('../../src/lib/filebase.js');
      const result = await uploadJson('test-bucket', 'test/key.json', { hello: 'world' });

      expect(result.key).toBe('test/key.json');
      expect(result.bucket).toBe('test-bucket');
      expect(result.cid).toBe('QmTestCid123');
    });
  });

  describe('uploadParquet', () => {
    it('uploads Parquet buffer and returns result', async () => {
      const { uploadParquet } = await import('../../src/lib/filebase.js');
      const buffer = Buffer.from([0x50, 0x41, 0x52, 0x31]); // PAR1 magic bytes
      const result = await uploadParquet('test-bucket', 'data.parquet', buffer);

      expect(result.key).toBe('data.parquet');
      expect(result.bucket).toBe('test-bucket');
    });
  });
});
