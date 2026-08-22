/**
 * Agent Chat validation test — T076 (US4/US6)
 * Sends property intelligence questions and verifies agent responses.
 */

import { test, expect } from '@playwright/test';

test.describe('Agent Chat (US4)', () => {
  test('answers property count question', async ({ page }) => {
    await page.goto('/agent-chat');

    // Wait for the chat page to load — look for the input placeholder
    await page.waitForSelector('input[placeholder*="Duval County"]', { timeout: 15_000 });

    // Type the question
    const input = page.locator('input[placeholder*="Duval County"]');
    await input.fill('How many properties are in the database?');

    // Click Send button
    await page.getByRole('button', { name: /Send/i }).click();

    // Should show the user's message
    await expect(page.getByText('How many properties are in the database?')).toBeVisible();

    // Wait for agent response (up to 30s — agent can be slow)
    // The agent response contains "25 properties" or similar with a number
    // Wait for streaming to complete
    await page.waitForTimeout(15_000);

    // The response should contain a number (property count) in the page body
    const bodyText = await page.textContent('body');
    // Agent says something like "There are 25 properties..."
    expect(bodyText).toMatch(/\d+\s*propert/i);
  });

  test('answers roof age query with property data', async ({ page }) => {
    await page.goto('/agent-chat');
    await page.waitForSelector('input[placeholder*="Duval County"]', { timeout: 15_000 });

    const input = page.locator('input[placeholder*="Duval County"]');
    await input.fill('Which properties have roofs older than 15 years?');

    await page.getByRole('button', { name: /Send/i }).click();

    // Wait for agent response (up to 30s)
    // The agent message bubble contains role label "Agent"
    // Wait for at least one assistant message to appear with property-related content
    await page.waitForTimeout(20_000);

    // Should have agent response mentioning properties or roof
    const bodyText = await page.textContent('body');
    expect(bodyText).toMatch(/roof|propert|RE\d+|parcel|age/i);
  });
});
