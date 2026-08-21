/**
 * Florida SunBiz corporate data source adapter.
 * T033 — Scrape FL SunBiz for corporate entity data to enrich ownership records.
 */

import type { SourceAdapter, RawRecord } from '../lib/types.js';

const SOURCE_ID = 'duval-sunbiz';
const BASE_URL = 'https://search.sunbiz.org/Inquiry/CorporationSearch';
const REQUEST_DELAY_MS = 2000;
const MAX_RETRIES = 3;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetch corporate entity data from SunBiz for an owner name.
 * We use the owner name associated with each parcel to look up corporate entities.
 */
async function fetchSunbizRecords(parcelId: string, retryCount = 0): Promise<RawRecord | null> {
  try {
    const { chromium } = await import('playwright');
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    try {
      await page.goto(`${BASE_URL}/SearchByName`, { waitUntil: 'domcontentloaded' });

      // Search by entity name (using parcel-linked owner name)
      const searchInput = page.locator('input[name="SearchTerm"], input#SearchTerm, input[type="text"]').first();
      await searchInput.fill(parcelId);
      await page.click('input[type="submit"], button[type="submit"], .search-btn');
      await page.waitForTimeout(3000);

      const rawData = await page.evaluate(() => {
        const entities: Array<Record<string, string>> = [];
        const rows = document.querySelectorAll('table tbody tr, .search-result');

        rows.forEach((row) => {
          const cells = row.querySelectorAll('td');
          if (cells.length >= 3) {
            entities.push({
              entity_name: cells[0]?.textContent?.trim() ?? '',
              document_number: cells[1]?.textContent?.trim() ?? '',
              status: cells[2]?.textContent?.trim() ?? '',
              filing_date: cells[3]?.textContent?.trim() ?? '',
              state: cells[4]?.textContent?.trim() ?? '',
              entity_type: cells[5]?.textContent?.trim() ?? '',
            });
          }
        });

        return { entities };
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
      return fetchSunbizRecords(parcelId, retryCount + 1);
    }
    console.error(`[${SOURCE_ID}] Failed for ${parcelId}:`, err);
    return null;
  }
}

export const sunbizAdapter: SourceAdapter = {
  source_id: SOURCE_ID,

  async fetch(parcelIds?: string[], options?: { limit?: number }): Promise<RawRecord[]> {
    if (!parcelIds || parcelIds.length === 0) return [];

    const limit = options?.limit ?? parcelIds.length;
    const idsToFetch = parcelIds.slice(0, limit);
    const results: RawRecord[] = [];

    console.info(`[${SOURCE_ID}] Fetching SunBiz records for ${idsToFetch.length} parcels`);

    for (const id of idsToFetch) {
      const record = await fetchSunbizRecords(id);
      if (record) results.push(record);
      await sleep(REQUEST_DELAY_MS);
    }

    return results;
  },
};

/**
 * Generate mock SunBiz corporate data for testing.
 */
export function generateMockSunbizRecord(parcelId: string): RawRecord {
  const entityTypes = ['LLC', 'Corp', 'LP', 'Inc', 'Trust', 'LLP'];
  const statuses = ['Active', 'Inactive', 'Dissolved', 'Revoked'];
  const states = ['FL', 'FL', 'FL', 'DE', 'NV', 'NY', 'GA'];

  // ~40% chance the owner is a corporate entity
  const isCorporate = Math.random() > 0.6;
  const numEntities = isCorporate ? 1 + Math.floor(Math.random() * 2) : 0;

  const entities = Array.from({ length: numEntities }, (_, i) => {
    const year = 2005 + Math.floor(Math.random() * 20);
    const month = String(1 + Math.floor(Math.random() * 12)).padStart(2, '0');
    const day = String(1 + Math.floor(Math.random() * 28)).padStart(2, '0');
    const entityType = entityTypes[Math.floor(Math.random() * entityTypes.length)]!;

    return {
      entity_name: `${parcelId} Properties ${entityType}`,
      document_number: `P${year}${String(Math.floor(Math.random() * 999999)).padStart(6, '0')}`,
      status: statuses[Math.floor(Math.random() * statuses.length)]!,
      filing_date: `${year}-${month}-${day}`,
      state: states[Math.floor(Math.random() * states.length)]!,
      entity_type: entityType,
      registered_agent: `Agent-${Math.floor(Math.random() * 100)}`,
      principal_address: `${Math.floor(Math.random() * 9999)} Corporate Blvd, Jacksonville, FL`,
    };
  });

  return {
    parcel_id: parcelId,
    source_id: SOURCE_ID,
    raw_data: { entities },
  };
}
