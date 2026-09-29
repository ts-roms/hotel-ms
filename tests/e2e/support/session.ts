import { expect, type Page } from '@playwright/test';

export const guestUrl = () => process.env.E2E_GUEST_URL ?? 'http://localhost:43200';

/** Where the setup step saves the signed-in staff session. */
export const STAFF_STATE = '.auth/staff.json';

/** A front-desk login: from the environment, or the demo seed's reception user. */
export async function credentials(): Promise<{ email: string; password: string } | null> {
  if (process.env.E2E_EMAIL && process.env.E2E_PASSWORD)
    return { email: process.env.E2E_EMAIL, password: process.env.E2E_PASSWORD };
  if (process.env.E2E_DEMO === 'false') return null;
  const { DEMO_PASSWORD } = await import('@hotel/database/testing');
  return { email: 'reception@abc.test', password: DEMO_PASSWORD };
}

export async function signIn(page: Page, login: { email: string; password: string }) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(login.email);
  await page.getByLabel('Password').fill(login.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/(dashboard|p\/)/);
}

/** Fails the test on uncaught page errors (console noise from the dev server is ignored). */
export function failOnPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}
