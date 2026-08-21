/**
 * IPNS pointer management via Filebase Names API.
 * T015 — Create, update, and resolve IPNS pointers.
 *
 * Filebase IPNS API: https://api.filebase.io/v1/names
 * Auth: Bearer token = base64(ACCESS_KEY:SECRET_KEY)
 */

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

function getAuthToken(): string {
  const accessKey = process.env.FILEBASE_ACCESS_KEY ?? '';
  const secretKey = process.env.FILEBASE_SECRET_KEY ?? '';
  return Buffer.from(`${accessKey}:${secretKey}`).toString('base64');
}

const NAMES_API = 'https://api.filebase.io/v1/names';

// ---------------------------------------------------------------------------
// IPNS labels for Duval County
// ---------------------------------------------------------------------------

export const IPNS_LABELS = {
  openData: 'oracle-open-data-duval',
  queryTable: 'oracle-query-table-duval',
} as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface IpnsName {
  label: string;
  network_key: string;
  cid: string;
  sequence: number;
  enabled: boolean;
  published_at: string;
}

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

async function apiRequest<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const url = `${NAMES_API}${path}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${getAuthToken()}`,
    'Content-Type': 'application/json',
  };

  const response = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`IPNS API ${method} ${path} failed (${response.status}): ${text}`);
  }

  return response.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * List all IPNS names.
 */
export async function listNames(): Promise<IpnsName[]> {
  return apiRequest<IpnsName[]>('GET', '');
}

/**
 * Get a specific IPNS name by label.
 */
export async function getName(label: string): Promise<IpnsName | null> {
  try {
    return await apiRequest<IpnsName>('GET', `/${label}`);
  } catch {
    return null;
  }
}

/**
 * Create a new IPNS name pointing to a CID.
 */
export async function createName(label: string, cid: string): Promise<IpnsName> {
  return apiRequest<IpnsName>('POST', '', { label, cid, enabled: true });
}

/**
 * Update an existing IPNS name to point to a new CID.
 */
export async function updateName(label: string, cid: string): Promise<IpnsName> {
  return apiRequest<IpnsName>('PUT', `/${label}`, { cid, enabled: true });
}

/**
 * Create or update an IPNS name. Creates if it doesn't exist, updates if it does.
 */
export async function upsertName(label: string, cid: string): Promise<IpnsName> {
  const existing = await getName(label);
  if (existing) {
    return updateName(label, cid);
  }
  return createName(label, cid);
}

/**
 * Resolve the current CID for an IPNS label.
 * Returns null if the name doesn't exist.
 */
export async function resolveIpns(label: string): Promise<string | null> {
  const name = await getName(label);
  return name?.cid ?? null;
}

/**
 * Delete an IPNS name.
 */
export async function deleteName(label: string): Promise<void> {
  await apiRequest<void>('DELETE', `/${label}`);
}

/**
 * Build the IPNS gateway URL for a label.
 * Requires resolving the label to its network_key first.
 */
export async function getIpnsGatewayUrl(label: string): Promise<string | null> {
  const name = await getName(label);
  if (!name) return null;
  return `https://ipfs.filebase.io/ipns/${name.network_key}`;
}
