import { test as setup } from '@playwright/test';
import { credentials, signIn, STAFF_STATE } from '../support/session.js';

/**
 * Signs in once through the real login page and saves the session for the other tests,
 * so a run makes one login (the login rate limit is part of what production enforces).
 */
setup('staff sign in', async ({ page }) => {
  const login = await credentials();
  if (!login) {
    // No credentials for this environment: authenticated tests skip themselves.
    await page.context().storageState({ path: STAFF_STATE });
    return;
  }
  await signIn(page, login);
  await page.context().storageState({ path: STAFF_STATE });
});
