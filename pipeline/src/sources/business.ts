/**
 * Duval County business tax receipt records source adapter.
 * T031 — Scrape business tax receipt data from the City of Jacksonville portal.
 */

import type { SourceAdapter, RawRecord } from '../lib/types.js';

const SOURCE_ID = 'duval-business';
const BASE_URL = 'https://www.coj.net/departments/finance/business-tax-receipts';
const REQUEST_DELAY_MS = 2000;
const MAX_RETRIES = 3;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetch business tax receipt records for a parcel via web scraping.
 */
async function fetchBusinessRecords(parcelId: string, retryCount = 0): Promise<RawRecord | null> {
  try {
    const { chromium } = await import('playwright');
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    try {
      await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });

      // Search by address or parcel reference
      const searchInput = page.locator('input[type="text"]').first();
      await searchInput.fill(parcelId);
      await page.click('button[type="submit"], input[type="submit"], .search-btn');
      await page.waitForTimeout(3000);

      const rawData = await page.evaluate(() => {
        const businesses: Array<Record<string, string>> = [];
        const rows = document.querySelectorAll('table tbody tr, .business-row');

        rows.forEach((row) => {
          const cells = row.querySelectorAll('td');
          if (cells.length >= 3) {
            businesses.push({
              business_name: cells[0]?.textContent?.trim() ?? '',
              receipt_number: cells[1]?.textContent?.trim() ?? '',
              business_type: cells[2]?.textContent?.trim() ?? '',
              address: cells[3]?.textContent?.trim() ?? '',
              issue_date: cells[4]?.textContent?.trim() ?? '',
              expiration_date: cells[5]?.textContent?.trim() ?? '',
              status: cells[6]?.textContent?.trim() ?? '',
            });
          }
        });

        return { businesses };
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
      return fetchBusinessRecords(parcelId, retryCount + 1);
    }
    console.error(`[${SOURCE_ID}] Failed for ${parcelId}:`, err);
    return null;
  }
}

export const businessAdapter: SourceAdapter = {
  source_id: SOURCE_ID,

  async fetch(parcelIds?: string[], options?: { limit?: number }): Promise<RawRecord[]> {
    if (!parcelIds || parcelIds.length === 0) return [];

    const limit = options?.limit ?? parcelIds.length;
    const idsToFetch = parcelIds.slice(0, limit);
    const results: RawRecord[] = [];

    console.info(`[${SOURCE_ID}] Fetching business records for ${idsToFetch.length} parcels`);

    for (const id of idsToFetch) {
      const record = await fetchBusinessRecords(id);
      if (record) results.push(record);
      await sleep(REQUEST_DELAY_MS);
    }

    return results;
  },
};

/**
 * Generate mock business tax receipt data for testing.
 */
export function generateMockBusinessRecord(parcelId: string): RawRecord {
  const businessTypes = [
    'General Contractor',
    'Plumbing',
    'Electrical',
    'HVAC',
    'Roofing',
    'Landscaping',
    'Real Estate',
    'Property Management',
    'Restaurant',
    'Retail',
  ];
  const statuses = ['Active', 'Expired', 'Pending Renewal'];
  const numBusinesses = Math.random() > 0.6 ? 1 + Math.floor(Math.random() * 3) : 0;

  const businesses = Array.from({ length: numBusinesses }, (_, i) => {
    const year = 2020 + Math.floor(Math.random() * 6);
    const month = String(1 + Math.floor(Math.random() * 12)).padStart(2, '0');

    return {
      business_name: `Business-${parcelId}-${i}`,
      receipt_number: `BTR-${year}-${String(Math.floor(Math.random() * 99999)).padStart(5, '0')}`,
      business_type: businessTypes[Math.floor(Math.random() * businessTypes.length)]!,
      address: `${Math.floor(Math.random() * 9999)} Main St, Jacksonville, FL`,
      issue_date: `${year}-${month}-01`,
      expiration_date: `${year + 1}-09-30`,
      status: statuses[Math.floor(Math.random() * statuses.length)]!,
    };
  });

  return {
    parcel_id: parcelId,
    source_id: SOURCE_ID,
    raw_data: { businesses },
  };
}
