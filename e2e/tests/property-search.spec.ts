/**
 * Property Search validation test — T075 (US4/US6)
 * Iterates all 6 query types, selects each from dropdown, verifies results.
 */

import { test, expect } from '@playwright/test';

// Query type values matching the <option> values in the select dropdown
const QUERY_TYPES = [
  { value: 'roof_age_gt_15', label: 'Roofs older than 15 years' },
  { value: 'water_view', label: 'View of water' },
  { value: 'ownership_tenure_gt_10', label: 'No ownership change in 10+ years' },
  { value: 'regional_owners', label: 'Regional owners' },
  { value: 'transit_walking', label: 'Walking distance to public transit' },
  { value: 'starbucks_walking', label: 'Walking distance to Starbucks' },
];

test.describe('Property Search (US4)', () => {
  for (const queryType of QUERY_TYPES) {
    test(`query: ${queryType.label}`, async ({ page }) => {
      await page.goto('/property-search');

      // Wait for the page to load — the select and table should be rendered
      await page.waitForSelector('#query-type', { timeout: 15_000 });

      // Select the query type from the native <select> element
      await page.selectOption('#query-type', queryType.value);

      // Wait for loading to finish — DuckDB initialization + Parquet fetch can take time
      // Wait until "Loading..." text disappears from the table body
      await page.waitForFunction(
        () => {
          const body = document.body.textContent ?? '';
          return !body.includes('Loading results...') && !body.includes('Loading...');
        },
        { timeout: 30_000 },
      );

      // Give React a moment to finish rendering
      await page.waitForTimeout(500);

      // Check for results — either a table with rows or "No results found" or a count
      const bodyText = await page.textContent('body') ?? '';

      // Should show results count (e.g., "12 results") or "No results found"
      const resultsMatch = bodyText.match(/(\d+) results/);
      const resultCount = resultsMatch ? parseInt(resultsMatch[1], 10) : 0;
      const noResults = /No results found/i.test(bodyText);

      // The query executed and showed a valid response (results or explicit "no results")
      expect(resultCount > 0 || noResults).toBeTruthy();

      if (resultCount > 0) {
        // If results exist, check for parcel IDs in the table (RE pattern)
        const table = page.locator('table');
        await expect(table).toBeVisible();
        const firstRow = table.locator('tbody tr').first();
        await expect(firstRow).toBeVisible();

        // Parcel IDs are in font-mono spans — check for RE pattern
        const rowText = await firstRow.textContent();
        expect(rowText).toMatch(/RE\d+/);
      }
    });
  }
});
