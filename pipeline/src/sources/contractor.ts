/**
 * Duval County contractor licensing records source adapter.
 * T032 — Scrape contractor licensing data from the City of Jacksonville portal.
 */

import type { SourceAdapter, RawRecord } from '../lib/types.js';

const SOURCE_ID = 'duval-contractor';
const BASE_URL = 'https://www.coj.net/departments/regulatory-compliance';
const REQUEST_DELAY_MS = 3000;
const MAX_RETRIES = 3;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetch contractor licensing records for a parcel via web scraping.
 */
async function fetchContractorRecords(parcelId: string, retryCount = 0): Promise<RawRecord | null> {
  try {
    const { chromium } = await import('playwright');
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    try {
      await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });

      const searchInput = page.locator('input[type="text"]').first();
      await searchInput.fill(parcelId);
      await page.click('button[type="submit"], input[type="submit"], .search-btn');
      await page.waitForTimeout(3000);

      const rawData = await page.evaluate(() => {
        const contractors: Array<Record<string, string>> = [];
        const rows = document.querySelectorAll('table tbody tr, .contractor-row');

        rows.forEach((row) => {
          const cells = row.querySelectorAll('td');
          if (cells.length >= 3) {
            contractors.push({
              contractor_name: cells[0]?.textContent?.trim() ?? '',
              license_number: cells[1]?.textContent?.trim() ?? '',
              license_type: cells[2]?.textContent?.trim() ?? '',
              status: cells[3]?.textContent?.trim() ?? '',
              issue_date: cells[4]?.textContent?.trim() ?? '',
              expiration_date: cells[5]?.textContent?.trim() ?? '',
              specialty: cells[6]?.textContent?.trim() ?? '',
            });
          }
        });

        return { contractors };
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
      return fetchContractorRecords(parcelId, retryCount + 1);
    }
    console.error(`[${SOURCE_ID}] Failed for ${parcelId}:`, err);
    return null;
  }
}

export const contractorAdapter: SourceAdapter = {
  source_id: SOURCE_ID,

  async fetch(parcelIds?: string[], options?: { limit?: number }): Promise<RawRecord[]> {
    if (!parcelIds || parcelIds.length === 0) return [];

    const limit = options?.limit ?? parcelIds.length;
    const idsToFetch = parcelIds.slice(0, limit);
    const results: RawRecord[] = [];

    console.info(`[${SOURCE_ID}] Fetching contractor records for ${idsToFetch.length} parcels`);

    for (const id of idsToFetch) {
      const record = await fetchContractorRecords(id);
      if (record) results.push(record);
      await sleep(REQUEST_DELAY_MS);
    }

    return results;
  },
};

/**
 * Generate mock contractor licensing data for testing.
 */
export function generateMockContractorRecord(parcelId: string): RawRecord {
  const licenseTypes = [
    'General Contractor',
    'Electrical Contractor',
    'Plumbing Contractor',
    'Mechanical Contractor',
    'Roofing Contractor',
    'Building Contractor',
  ];
  const specialties = [
    'Residential',
    'Commercial',
    'Residential & Commercial',
    'Industrial',
  ];
  const statuses = ['Active', 'Expired', 'Suspended', 'Revoked'];
  const numContractors = Math.random() > 0.5 ? 1 + Math.floor(Math.random() * 3) : 0;

  const contractors = Array.from({ length: numContractors }, (_, i) => {
    const year = 2018 + Math.floor(Math.random() * 8);
    const month = String(1 + Math.floor(Math.random() * 12)).padStart(2, '0');

    return {
      contractor_name: `Contractor-${parcelId}-${i}`,
      license_number: `CLN-${year}-${String(Math.floor(Math.random() * 99999)).padStart(5, '0')}`,
      license_type: licenseTypes[Math.floor(Math.random() * licenseTypes.length)]!,
      status: statuses[Math.floor(Math.random() * statuses.length)]!,
      issue_date: `${year}-${month}-01`,
      expiration_date: `${year + 2}-${month}-01`,
      specialty: specialties[Math.floor(Math.random() * specialties.length)]!,
    };
  });

  return {
    parcel_id: parcelId,
    source_id: SOURCE_ID,
    raw_data: { contractors },
  };
}
