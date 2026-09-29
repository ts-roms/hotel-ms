import { expect, test } from '@playwright/test';
import { credentials, failOnPageErrors } from '../support/session.js';

const nextDay = (date: string) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

/**
 * The front desk's day, end to end in the browser: book a walk-in, give them a room, check
 * them in and out. Writes data, so it runs against local and CI stacks only (@flow).
 */
test('a walk-in is booked, checked in and checked out @flow', async ({ page }) => {
  test.skip(!(await credentials()), 'No E2E credentials for this environment');
  const errors = failOnPageErrors(page);

  const properties = await (await page.request.get('/api/v1/properties')).json();
  const manila = properties.items.find((p: { code: string }) => p.code === 'MNL');
  expect(manila, 'the demo Manila property').toBeTruthy();
  const arrival: string = manila.currentBusinessDate;

  // A room type with a room free tonight (each run uses one room-night of the demo data).
  const availability = await (
    await page.request.get(
      `/api/v1/properties/${manila.id}/availability?from=${arrival}&to=${nextDay(arrival)}`,
    )
  ).json();
  const roomType = availability.roomTypes.find(
    (t: { nights: { available: number }[] }) => t.nights[0]!.available > 0,
  );
  test.skip(!roomType, 'No room free tonight: reseed the E2E database');

  await page.goto(`/p/${manila.id}/reservations/new`);
  const lastName = `E2E-${Date.now().toString(36)}`;
  await page.getByLabel('First name').fill('Wally');
  await page.getByLabel('Last name').fill(lastName);
  await page.getByLabel('Arrival').fill(arrival);
  await page.getByLabel('Departure').fill(nextDay(arrival));
  await page.getByLabel('Room type').selectOption(roomType.roomTypeId);
  const create = page.getByRole('button', { name: 'Create reservation' });
  await expect(create).toBeEnabled();
  await create.click();
  await expect(page).toHaveURL(/\/reservations\/[0-9a-f-]{36}$/);
  await expect(page.getByText(`Wally ${lastName}`)).toBeVisible();

  // A free room of the booked type. A room may still be held tonight by a guest who left
  // earlier today (e.g. a previous run), which the API refuses; then try the next one.
  const room = page.getByLabel('Room', { exact: true });
  const candidates = await room
    .locator('option:not([disabled]):not([value=""])')
    .evaluateAll((options) => options.map((o) => (o as HTMLOptionElement).value));
  expect(candidates.length, 'rooms of the booked type').toBeGreaterThan(0);
  const checkIn = page.getByRole('button', { name: 'Check in' });
  for (const candidate of candidates) {
    await room.selectOption(candidate);
    const assigned = page.waitForResponse(
      (r) => r.url().endsWith('/assignment') && r.request().method() === 'PUT',
    );
    await page.getByRole('button', { name: 'Assign', exact: true }).click();
    if ((await assigned).ok()) break;
  }
  await expect(checkIn).toBeVisible();

  await checkIn.click();
  await expect(page.getByText('In house')).toBeVisible();

  await page.getByRole('button', { name: 'Check out' }).click();
  await expect(page.getByText('Checked out')).toBeVisible();
  expect(errors).toEqual([]);
});
