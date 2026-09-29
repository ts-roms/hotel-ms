import { expect, test } from '@playwright/test';
import { credentials, failOnPageErrors, guestUrl } from '../support/session.js';

/**
 * Smoke tests: read-only, safe against any environment including staging (`--grep @smoke`).
 */
test.describe('smoke @smoke', () => {
  test('the sign-in page loads and the API refuses anonymous requests', async ({ browser }) => {
    // A fresh context: no saved session.
    const context = await browser.newContext({ storageState: undefined });
    const page = await context.newPage();
    const errors = failOnPageErrors(page);
    await page.goto('/login');
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
    const session = await page.request.get('/api/v1/auth/session');
    expect(session.status()).toBe(401);
    expect(await session.json()).toMatchObject({ code: 'UNAUTHENTICATED' });
    expect(errors).toEqual([]);
    await context.close();
  });

  test('signed-in staff reach the dashboard and a property', async ({ page }) => {
    test.skip(!(await credentials()), 'No E2E credentials for this environment');
    const errors = failOnPageErrors(page);
    await page.goto('/dashboard');
    await expect(page.getByRole('link', { name: 'Reservations' }).first()).toBeVisible();
    await page.getByRole('link', { name: 'Reservations' }).first().click();
    await expect(page).toHaveURL(/\/p\/[^/]+\/reservations/);
    await expect(page.getByRole('heading', { name: 'Reservations' })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('the guest portal answers, and staff APIs are not reachable through it', async ({
    page,
  }) => {
    await page.goto(guestUrl());
    await expect(page).toHaveTitle(/My stay/);
    const stay = await page.request.get(`${guestUrl()}/api/v1/guest/stay`);
    expect(stay.status()).toBe(401);
  });
});
