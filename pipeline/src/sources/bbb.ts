/**
 * Better Business Bureau contractor reputation data source adapter.
 * T034 — Scrape BBB for contractor reputation data to enrich contractor records.
 */

import type { SourceAdapter, RawRecord } from '../lib/types.js';

const SOURCE_ID = 'duval-bbb';
const BASE_URL = 'https://www.bbb.org/search';
const REQUEST_DELAY_MS = 2500;
const MAX_RETRIES = 3;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetch BBB contractor reputation data via web scraping.
 */
async function fetchBBBRecords(parcelId: string, retryCount = 0): Promise<RawRecord | null> {
  try {
    const { chromium } = await import('playwright');
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    try {
      // Search BBB by location (Jacksonville, FL area)
      const searchUrl = `${BASE_URL}?find_loc=Jacksonville%2C+FL&find_text=${encodeURIComponent(parcelId)}`;
      await page.goto(searchUrl, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(3000);

      const rawData = await page.evaluate(() => {
        const contractors: Array<Record<string, string>> = [];
        const results = document.querySelectorAll('.search-result, .result-item, article');

        results.forEach((result) => {
          const nameEl = result.querySelector('h3, .business-name, .result-name');
          const ratingEl = result.querySelector('.bbb-rating, .rating, [class*="rating"]');
          const categoryEl = result.querySelector('.category, .business-category');
          const addressEl = result.querySelector('.address, .location');
          const phoneEl = result.querySelector('.phone, [class*="phone"]');
          const reviewsEl = result.querySelector('.reviews, .review-count');
          const accreditedEl = result.querySelector('.accredited, [class*="accredited"]');

          if (nameEl) {
            contractors.push({
              business_name: nameEl.textContent?.trim() ?? '',
              bbb_rating: ratingEl?.textContent?.trim() ?? '',
              category: categoryEl?.textContent?.trim() ?? '',
              address: addressEl?.textContent?.trim() ?? '',
              phone: phoneEl?.textContent?.trim() ?? '',
              review_count: reviewsEl?.textContent?.trim() ?? '',
              is_accredited: accreditedEl ? 'true' : 'false',
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
      return fetchBBBRecords(parcelId, retryCount + 1);
    }
    console.error(`[${SOURCE_ID}] Failed for ${parcelId}:`, err);
    return null;
  }
}

export const bbbAdapter: SourceAdapter = {
  source_id: SOURCE_ID,

  async fetch(parcelIds?: string[], options?: { limit?: number }): Promise<RawRecord[]> {
    if (!parcelIds || parcelIds.length === 0) return [];

    const limit = options?.limit ?? parcelIds.length;
    const idsToFetch = parcelIds.slice(0, limit);
    const results: RawRecord[] = [];

    console.info(`[${SOURCE_ID}] Fetching BBB records for ${idsToFetch.length} parcels`);

    for (const id of idsToFetch) {
      const record = await fetchBBBRecords(id);
      if (record) results.push(record);
      await sleep(REQUEST_DELAY_MS);
    }

    return results;
  },
};

/**
 * Generate mock BBB contractor reputation data for testing.
 */
export function generateMockBBBRecord(parcelId: string): RawRecord {
  const ratings = ['A+', 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'NR'];
  const categories = [
    'Roofing Contractors',
    'General Contractors',
    'Plumbing Contractors',
    'Electrical Contractors',
    'HVAC Contractors',
    'Home Improvement',
    'Painting Contractors',
  ];

  // ~30% chance of having BBB-listed contractors associated with this property
  const hasContractors = Math.random() > 0.7;
  const numContractors = hasContractors ? 1 + Math.floor(Math.random() * 3) : 0;

  const contractors = Array.from({ length: numContractors }, (_, i) => {
    const isAccredited = Math.random() > 0.4;
    const reviewCount = Math.floor(Math.random() * 50);
    const ratingIdx = isAccredited
      ? Math.floor(Math.random() * 3)  // A+, A, A- for accredited
      : Math.floor(Math.random() * ratings.length);

    return {
      business_name: `${categories[Math.floor(Math.random() * categories.length)]!.split(' ')[0]} Pro Services ${i + 1}`,
      bbb_rating: ratings[ratingIdx]!,
      category: categories[Math.floor(Math.random() * categories.length)]!,
      address: `${Math.floor(Math.random() * 9999)} Business Pkwy, Jacksonville, FL`,
      phone: `(904) ${String(Math.floor(Math.random() * 900) + 100)}-${String(Math.floor(Math.random() * 9000) + 1000)}`,
      review_count: String(reviewCount),
      is_accredited: String(isAccredited),
      complaints_last_3_years: String(Math.floor(Math.random() * 5)),
    };
  });

  return {
    parcel_id: parcelId,
    source_id: SOURCE_ID,
    raw_data: { contractors },
  };
}
