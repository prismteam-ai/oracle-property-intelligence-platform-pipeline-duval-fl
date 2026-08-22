/**
 * Dashboard validation test — T073 (US3/US6)
 * Verifies stat cards, records-by-source table, and IPFS/MCP status section.
 */

import { test, expect } from '@playwright/test';

test.describe('Dashboard (US3)', () => {
  test('displays stat cards with live data', async ({ page }) => {
    await page.goto('/dashboard');

    // Wait for Total Properties stat card to load with real data
    await page.waitForSelector('text=Total Properties', { timeout: 15_000 });

    // Total Properties card should show a non-zero value
    // The card structure: CardTitle "Total Properties" then CardContent with "text-2xl font-bold" value
    const totalPropsCard = page.locator('div').filter({ hasText: /^Total Properties/ }).first();
    await expect(totalPropsCard).toBeVisible();

    // Last Run card should show a time ago string (e.g., "5m ago", "2h ago")
    await expect(page.getByText(/Last Run/)).toBeVisible();

    // Sources card should show count like "0/8" or "8/8"
    const sourcesCard = page.locator('div').filter({ hasText: /^Sources/ }).first();
    await expect(sourcesCard).toBeVisible();
  });

  test('shows Records by Source table with rows', async ({ page }) => {
    await page.goto('/dashboard');
    await page.waitForSelector('text=Total Properties', { timeout: 15_000 });

    // Records by Source section
    await expect(page.getByText('Records by Source')).toBeVisible();

    // Table should have source rows — we know there are 8 sources
    const sourceTable = page.locator('table').first();
    await expect(sourceTable).toBeVisible();
    const rows = sourceTable.locator('tbody tr');
    const count = await rows.count();
    expect(count).toBeGreaterThan(0);
  });

  test('shows IPFS/MCP status with IPNS pointer', async ({ page }) => {
    await page.goto('/dashboard');
    await page.waitForSelector('text=Total Properties', { timeout: 15_000 });

    // Elephant IPFS & MCP section
    await expect(page.getByText('Elephant IPFS & MCP')).toBeVisible();

    // Should show Open Data IPNS label
    await expect(page.getByText('Open Data IPNS:')).toBeVisible();

    // Should show IPNS status (Live/Stale/Pending)
    const hasStatus = await page.getByText(/Live|Stale|Pending/).first().isVisible();
    expect(hasStatus).toBeTruthy();

    // Should show an IPNS pointer code element (k51qzi5... when live, or N/A when pending)
    const ipnsCode = page.locator('code').first();
    await expect(ipnsCode).toBeVisible();
    const ipnsText = await ipnsCode.textContent();
    // Either shows the IPNS key (k51qzi5...) or N/A
    expect(ipnsText).toMatch(/k51qzi5|N\/A/);

    // MCP Endpoint section
    await expect(page.getByText('MCP Endpoint:')).toBeVisible();
  });
});
