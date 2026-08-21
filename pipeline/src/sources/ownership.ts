/**
 * Duval County ownership transfer records source adapter.
 * T023 — Extract ownership history from the appraiser portal.
 */

import type { SourceAdapter, RawRecord } from '../lib/types.js';

const SOURCE_ID = 'duval-ownership';
const BASE_URL = 'https://paopropertysearch.coj.net';
const REQUEST_DELAY_MS = 1500;
const MAX_RETRIES = 3;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchOwnership(parcelId: string, retryCount = 0): Promise<RawRecord | null> {
  try {
    const { chromium } = await import('playwright');
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    try {
      await page.goto(`${BASE_URL}/Basic/Search`, { waitUntil: 'domcontentloaded' });
      await page.fill('input[type="text"]', parcelId);
      await page.click('button[type="submit"], input[type="submit"]');
      await page.waitForTimeout(2000);

      const rawData = await page.evaluate(() => {
        const transfers: Array<Record<string, string>> = [];
        const tables = document.querySelectorAll('table');

        tables.forEach((table) => {
          const rows = table.querySelectorAll('tr');
          rows.forEach((row) => {
            const cells = row.querySelectorAll('td');
            if (cells.length >= 3) {
              transfers.push({
                owner_name: cells[0]?.textContent?.trim() ?? '',
                transfer_date: cells[1]?.textContent?.trim() ?? '',
                sale_price: cells[2]?.textContent?.trim() ?? '',
                deed_type: cells[3]?.textContent?.trim() ?? '',
                instrument_number: cells[4]?.textContent?.trim() ?? '',
              });
            }
          });
        });

        const currentOwner = document.querySelector('.owner-name, .OwnerName')?.textContent?.trim() ?? '';
        const ownerAddress = document.querySelector('.mailing-address, .MailingAddress')?.textContent?.trim() ?? '';

        return { transfers, current_owner: currentOwner, owner_mailing_address: ownerAddress };
      });

      return { parcel_id: parcelId, source_id: SOURCE_ID, raw_data: rawData };
    } finally {
      await browser.close();
    }
  } catch (err) {
    if (retryCount < MAX_RETRIES) {
      await sleep(REQUEST_DELAY_MS * (retryCount + 1));
      return fetchOwnership(parcelId, retryCount + 1);
    }
    console.error(`[${SOURCE_ID}] Failed for ${parcelId}:`, err);
    return null;
  }
}

export const ownershipAdapter: SourceAdapter = {
  source_id: SOURCE_ID,

  async fetch(parcelIds?: string[], options?: { limit?: number }): Promise<RawRecord[]> {
    if (!parcelIds || parcelIds.length === 0) return [];

    const limit = options?.limit ?? parcelIds.length;
    const idsToFetch = parcelIds.slice(0, limit);
    const results: RawRecord[] = [];

    console.info(`[${SOURCE_ID}] Fetching ownership for ${idsToFetch.length} parcels`);

    for (const id of idsToFetch) {
      const record = await fetchOwnership(id);
      if (record) results.push(record);
      await sleep(REQUEST_DELAY_MS);
    }

    return results;
  },
};

/**
 * Generate mock ownership data for testing.
 */
export function generateMockOwnershipRecord(parcelId: string): RawRecord {
  const numTransfers = 1 + Math.floor(Math.random() * 4);
  const isRegional = Math.random() > 0.7;
  const ownerCities = isRegional
    ? ['Miami', 'Tampa', 'Orlando', 'Atlanta', 'New York']
    : ['Jacksonville', 'Jacksonville Beach', 'Neptune Beach'];
  const ownerStates = isRegional
    ? ['FL', 'FL', 'FL', 'GA', 'NY']
    : ['FL', 'FL', 'FL'];

  const cityIdx = Math.floor(Math.random() * ownerCities.length);
  const city = ownerCities[cityIdx]!;
  const state = ownerStates[cityIdx]!;

  const transfers = Array.from({ length: numTransfers }, (_, i) => {
    const year = 2000 + Math.floor(Math.random() * 24);
    const month = String(1 + Math.floor(Math.random() * 12)).padStart(2, '0');
    const day = String(1 + Math.floor(Math.random() * 28)).padStart(2, '0');

    return {
      owner_name: `Owner-${parcelId}-${i}`,
      transfer_date: `${year}-${month}-${day}`,
      sale_price: String(100000 + Math.floor(Math.random() * 500000)),
      deed_type: ['WD', 'QCD', 'TD'][Math.floor(Math.random() * 3)],
      instrument_number: `DOC-${year}-${String(Math.floor(Math.random() * 99999)).padStart(5, '0')}`,
    };
  }).sort((a, b) => b.transfer_date.localeCompare(a.transfer_date));

  return {
    parcel_id: parcelId,
    source_id: SOURCE_ID,
    raw_data: {
      transfers,
      current_owner: transfers[0]?.owner_name ?? `Owner-${parcelId}`,
      owner_mailing_address: `${Math.floor(Math.random() * 9999)} Main St, ${city}, ${state} 32200`,
    },
  };
}
