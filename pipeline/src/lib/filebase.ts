/**
 * Filebase S3 client wrapper for IPFS uploads.
 * T014 — Upload JSON and Parquet files, retrieve CIDs.
 */

import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
  type PutObjectCommandInput,
} from '@aws-sdk/client-s3';

// ---------------------------------------------------------------------------
// Client singleton
// ---------------------------------------------------------------------------

let s3Client: S3Client | null = null;

function getClient(): S3Client {
  if (!s3Client) {
    s3Client = new S3Client({
      endpoint: 'https://s3.filebase.com',
      region: 'us-east-1',
      credentials: {
        accessKeyId: process.env.FILEBASE_ACCESS_KEY ?? '',
        secretAccessKey: process.env.FILEBASE_SECRET_KEY ?? '',
      },
      forcePathStyle: true,
    });
  }
  return s3Client;
}

// ---------------------------------------------------------------------------
// Bucket names
// ---------------------------------------------------------------------------

export function openDataBucket(): string {
  return process.env.FILEBASE_BUCKET_OPEN_DATA ?? 'elephant-oracle-open-data-duval';
}

export function queryTableBucket(): string {
  return process.env.FILEBASE_BUCKET_QUERY_TABLE ?? 'elephant-oracle-query-table-duval';
}

// ---------------------------------------------------------------------------
// Upload helpers
// ---------------------------------------------------------------------------

export interface UploadResult {
  key: string;
  bucket: string;
  cid: string | null;
}

/**
 * Upload a JSON object to Filebase.
 * Returns the CID from the x-amz-meta-cid response header.
 */
export async function uploadJson(
  bucket: string,
  key: string,
  data: unknown,
): Promise<UploadResult> {
  const body = JSON.stringify(data);
  return uploadBuffer(bucket, key, Buffer.from(body, 'utf-8'), 'application/json');
}

/**
 * Upload raw bytes to Filebase.
 */
export async function uploadBuffer(
  bucket: string,
  key: string,
  body: Buffer,
  contentType: string,
): Promise<UploadResult> {
  const client = getClient();

  const params: PutObjectCommandInput = {
    Bucket: bucket,
    Key: key,
    Body: body,
    ContentType: contentType,
  };

  await client.send(new PutObjectCommand(params));

  // Retrieve CID via HeadObject — Filebase stores it in x-amz-meta-cid
  const cid = await getCid(bucket, key);

  return { key, bucket, cid };
}

/**
 * Upload a Parquet file to Filebase.
 */
export async function uploadParquet(
  bucket: string,
  key: string,
  parquetBuffer: Buffer,
): Promise<UploadResult> {
  return uploadBuffer(bucket, key, parquetBuffer, 'application/octet-stream');
}

/**
 * Get the CID for an uploaded object via HeadObject.
 * Filebase returns it in the x-amz-meta-cid header.
 */
export async function getCid(bucket: string, key: string): Promise<string | null> {
  const client = getClient();

  try {
    const head = await client.send(
      new HeadObjectCommand({ Bucket: bucket, Key: key }),
    );

    // Filebase stores CID in metadata
    return head.Metadata?.['cid'] ?? null;
  } catch {
    return null;
  }
}

/**
 * Compute CID locally using ipfs-only-hash.
 * Useful for pre-computing CIDs before upload.
 */
export async function computeCid(data: Buffer): Promise<string> {
  // ipfs-only-hash is a CJS module; dynamic import for ESM compatibility
  const { of } = await import('ipfs-only-hash');
  return of(data);
}

/**
 * Build the IPFS gateway URL for a given CID.
 */
export function ipfsGatewayUrl(cid: string): string {
  return `https://ipfs.filebase.io/ipfs/${cid}`;
}

/**
 * Build the IPNS gateway URL for a given IPNS key.
 */
export function ipnsGatewayUrl(ipnsKey: string): string {
  return `https://ipfs.filebase.io/ipns/${ipnsKey}`;
}
