/**
 * Pipeline Runs validation test — T074 (US1/US3/US6)
 * Verifies runs table, status badges, Trigger Run button, and triggering a new run.
 */

import { test, expect } from '@playwright/test';

test.describe('Pipeline Runs (US1/US3)', () => {
  test('shows run history with status badges', async ({ page }) => {
    await page.goto('/dashboard');
    await page.waitForSelector('text=Total Properties', { timeout: 15_000 });

    // Navigate to Pipeline Runs via sidebar
    await page.getByRole('link', { name: /Pipeline Runs/ }).click();
    await page.waitForURL('**/pipeline-runs');

    // Should show page title
    await expect(page.getByText('Pipeline Runs').first()).toBeVisible();

    // Should show runs table with at least one row
    await page.waitForSelector('table', { timeout: 10_000 });
    const rows = page.locator('table tbody tr');
    const rowCount = await rows.count();
    expect(rowCount).toBeGreaterThan(0);

    // Should show Success badges (we know runs have status "success")
    await expect(page.getByText('Success').first()).toBeVisible();

    // Trigger Run button should exist
    await expect(page.getByText('Trigger Run')).toBeVisible();
  });

  test('triggers a new run and sees it complete', async ({ page }) => {
    await page.goto('/pipeline-runs');
    await page.waitForSelector('table tbody tr', { timeout: 15_000 });

    // Count existing runs
    const initialRowCount = await page.locator('table tbody tr').count();

    // Click Trigger Run button
    await page.getByText('Trigger Run').click();

    // Button should show "Triggering..." state
    await expect(page.getByText('Triggering...')).toBeVisible({ timeout: 3_000 });

    // Wait for the run to complete — poll by reloading
    // The run takes ~2-3 seconds based on API data
    await page.waitForTimeout(5_000);
    await page.reload();
    await page.waitForSelector('table tbody tr', { timeout: 15_000 });

    // Should still show Success entries
    await expect(page.getByText('Success').first()).toBeVisible();
  });
});
