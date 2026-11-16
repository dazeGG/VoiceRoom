import { expect, test } from '@playwright/test';
import { authUser } from '../test/fixtures/users';
import { member } from '../test/fixtures/answers';

test('two tabs hide the old viewer before server revalidation and ignore its delayed directory', async ({
  context
}) => {
  let current = authUser();
  let holdRoster = false;
  let releaseRoster!: () => void;
  const rosterGate = new Promise<void>((resolve) => {
    releaseRoster = resolve;
  });
  let holdMe = false;
  let releaseMe!: () => void;
  const meGate = new Promise<void>((resolve) => {
    releaseMe = resolve;
  });
  await context.route('**/api/auth/me', async (route) => {
    if (holdMe) await meGate;
    await route.fulfill({ json: { ok: true, user: current } });
  });
  await context.route('**/api/rooms/room/members?*', async (route) => {
    const viewer = current;
    if (holdRoster) await rosterGate;
    await route.fulfill({
      json: {
        contractVersion: 1,
        roomId: 'room',
        members: [member({ userId: viewer.id, displayName: viewer.displayName === 'B' ? 'Only B' : 'Only A' })],
        pageInfo: { hasMore: false },
        presenceRevision: 1
      }
    });
  });
  const first = await context.newPage();
  const second = await context.newPage();
  await first.goto('http://127.0.0.1:15180/test/browser/security-cache.html');
  await expect(first.getByRole('button', { name: 'Профиль Only A', exact: true })).toBeVisible();
  await second.goto('http://127.0.0.1:15180/test/browser/security-cache.html');
  await expect(second.getByRole('button', { name: 'Профиль Only A', exact: true })).toBeVisible();
  // Wait for any initial-tab invalidation to settle before the controlled switch.
  await expect(first.getByRole('button', { name: 'Профиль Only A', exact: true })).toBeVisible();
  holdRoster = true;
  const oldRequest = second.waitForRequest('**/api/rooms/room/members?*');
  await second.getByRole('button', { name: 'Reload roster' }).click();
  await oldRequest;
  current = authUser({ id: '22222222-2222-4222-8222-222222222222', displayName: 'B' });
  holdMe = true;
  await first.getByRole('button', { name: 'Switch to B' }).click();
  await expect(second.getByRole('button', { name: 'Профиль Only A', exact: true })).toHaveCount(0);
  await expect(second.getByText('Список участников виден после входа в аккаунт.')).toBeVisible();
  releaseRoster();
  await expect(second.getByRole('button', { name: 'Профиль Only A', exact: true })).toHaveCount(0);
  releaseMe();
  await expect(second.getByRole('button', { name: 'Профиль Only B', exact: true })).toBeVisible();
  await expect(second.getByRole('button', { name: 'Профиль Only A', exact: true })).toHaveCount(0);
  expect(
    await second.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith('voice-room:membership:v1:')))
  ).toEqual([]);
});

test('visibility revalidation with unavailable storage hides old members before the server replies', async ({
  page
}) => {
  let current = authUser();
  let hold = false;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/auth/me', async (route) => {
    if (hold) await gate;
    await route.fulfill({ json: { ok: true, user: current } });
  });
  await page.route('**/api/rooms/room/members?*', (route) =>
    route.fulfill({
      json: {
        contractVersion: 1,
        roomId: 'room',
        members: [member({ userId: current.id, displayName: current.displayName === 'B' ? 'Only B' : 'Only A' })],
        pageInfo: { hasMore: false },
        presenceRevision: 1
      }
    })
  );
  await page.goto('http://127.0.0.1:15180/test/browser/security-cache.html');
  await expect(page.getByRole('button', { name: 'Профиль Only A', exact: true })).toBeVisible();
  current = authUser({ id: '22222222-2222-4222-8222-222222222222', displayName: 'B' });
  hold = true;
  await page.evaluate(() => {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('denied', 'SecurityError');
      }
    });
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(page.getByRole('button', { name: 'Профиль Only A', exact: true })).toHaveCount(0);
  await expect(page.getByText('Список участников виден после входа в аккаунт.')).toBeVisible();
  release();
  await expect(page.getByRole('button', { name: 'Профиль Only B', exact: true })).toBeVisible();
});
