/**
 * Duval County building permits source adapter.
 * T022 — Harvest permits data, linked to properties by parcel ID.
 */

import type { SourceAdapter, RawRecord } from '../lib/types.js';

const SOURCE_ID = 'duval-permits';
const BASE_URL = 'https://buildinginspections.coj.net';
const REQUEST_DELAY_MS = 1500;
const MAX_RETRIES = 3;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetch permits for a single parcel via browser automation.
 */
async function fetchPermits(parcelId: string, retryCount = 0): Promise<RawRecord | null> {
  try {
    const { chromium } = await import('playwright');
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    try {
      await page.goto(`${BASE_URL}/Search`, { waitUntil: 'domcontentloaded' });

      // Search by parcel / address
      await page.fill('input[type="text"]', parcelId);
      await page.click('button[type="submit"], input[type="submit"]');
      await page.waitForTimeout(2000);

      const rawData = await page.evaluate(() => {
        const permits: Array<Record<string, string>> = [];
        const rows = document.querySelectorAll('table tbody tr, .permit-row');

        rows.forEach((row) => {
          const cells = row.querySelectorAll('td');
          if (cells.length >= 4) {
            permits.push({
              permit_number: cells[0]?.textContent?.trim() ?? '',
              permit_type: cells[1]?.textContent?.trim() ?? '',
              issue_date: cells[2]?.textContent?.trim() ?? '',
              description: cells[3]?.textContent?.trim() ?? '',
              status: cells[4]?.textContent?.trim() ?? '',
              contractor: cells[5]?.textContent?.trim() ?? '',
            });
          }
        });

        return { permits };
      });

      return {
        parcel_id: parcelId,
        source_id: SOURCE_ID,
        raw_data: rawData,
      };
    } finally {
      await browser.close();
    }
  } catch (err) {
    if (retryCount < MAX_RETRIES) {
      console.warn(`[${SOURCE_ID}] Retry ${retryCount + 1} for ${parcelId}: ${err}`);
      await sleep(REQUEST_DELAY_MS * (retryCount + 1));
      return fetchPermits(parcelId, retryCount + 1);
    }
    console.error(`[${SOURCE_ID}] Failed to fetch permits for ${parcelId}:`, err);
    return null;
  }
}

export const permitsAdapter: SourceAdapter = {
  source_id: SOURCE_ID,

  async fetch(parcelIds?: string[], options?: { limit?: number }): Promise<RawRecord[]> {
    if (!parcelIds || parcelIds.length === 0) return [];

    const limit = options?.limit ?? parcelIds.length;
    const idsToFetch = parcelIds.slice(0, limit);
    const results: RawRecord[] = [];

    console.info(`[${SOURCE_ID}] Fetching permits for ${idsToFetch.length} parcels`);

    for (const id of idsToFetch) {
      const record = await fetchPermits(id);
      if (record) results.push(record);
      await sleep(REQUEST_DELAY_MS);
    }

    return results;
  },
};

/**
 * Generate mock permit data for testing.
 */
export function generateMockPermitRecord(parcelId: string): RawRecord {
  const permitTypes = ['Building', 'Electrical', 'Plumbing', 'Mechanical', 'Roofing', 'Demo'];
  const statuses = ['Issued', 'Final', 'Closed', 'Active'];
  const numPermits = 1 + Math.floor(Math.random() * 5);

  const permits = Array.from({ length: numPermits }, (_, i) => {
    const year = 2015 + Math.floor(Math.random() * 10);
    const month = String(1 + Math.floor(Math.random() * 12)).padStart(2, '0');
    const day = String(1 + Math.floor(Math.random() * 28)).padStart(2, '0');

    return {
      permit_number: `BLD-${year}-${String(1000 + i).padStart(6, '0')}`,
      permit_type: permitTypes[Math.floor(Math.random() * permitTypes.length)],
      issue_date: `${year}-${month}-${day}`,
      description: `Permit for ${parcelId}`,
      status: statuses[Math.floor(Math.random() * statuses.length)],
      contractor: `Contractor-${Math.floor(Math.random() * 100)}`,
      estimated_cost: 5000 + Math.floor(Math.random() * 50000),
    };
  });

  return {
    parcel_id: parcelId,
    source_id: SOURCE_ID,
    raw_data: { permits },
  };
}
