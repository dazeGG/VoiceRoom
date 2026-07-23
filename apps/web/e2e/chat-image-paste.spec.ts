import { expect, test } from '@playwright/test';
import { registerViaUi, uniqueLogin } from './helpers';

const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAACXBIWXMAAAPoAAAD6AG1e1JrAAAARUlEQVRYhe3XsREAMAhC0YzIOIzoVmaLpHmFvXcifE4z+3OOBeoEIcLxhsuIyoojjEYcLyApJAsoHVi+iklVsyin81wHF4vcPJcf4sTZAAAAAElFTkSuQmCC';

test('pasting a PNG uploads, processes, and sends it without a file-picker button', async ({ page }) => {
  const login = uniqueLogin('paste');
  await registerViaUi(page, login);

  await page.getByRole('button', { name: 'Создать комнату' }).click();
  const dialog = page.getByRole('dialog', { name: 'Новая комната' });
  await dialog.getByPlaceholder('Название комнаты').fill(`Paste ${login}`);
  await Promise.all([
    page.waitForResponse(
      (response) => response.url().endsWith('/api/rooms') && response.request().method() === 'POST'
    ),
    dialog.getByRole('button', { name: 'Создать комнату' }).click()
  ]);
  await expect(page.locator('body')).toHaveAttribute('data-screen', 'room', { timeout: 20_000 });

  await page.getByRole('button', { name: 'Чат', exact: true }).click();
  const input = page.locator('.chat-rail-input');
  await expect(input).toBeVisible();
  await expect(page.getByRole('button', { name: 'Добавить изображения' })).toHaveCount(0);

  await input.focus();
  await expect.poll(() => input.evaluate((element) => getComputedStyle(element).borderColor))
    .toBe('rgba(255, 255, 255, 0.72)');

  const slotResponse = page.waitForResponse((response) =>
    response.url().endsWith('/api/media/attachments')
      && response.request().method() === 'POST'
  );
  const uploadResponse = page.waitForResponse((response) =>
    /\/api\/media\/attachments\/[^/]+\/content$/.test(response.url())
      && response.request().method() === 'PUT'
  );

  await input.evaluate((element, encoded) => {
    const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], 'clipboard.png', { type: 'image/png' }));
    element.dispatchEvent(new ClipboardEvent('paste', {
      bubbles: true,
      cancelable: true,
      clipboardData: transfer
    }));
  }, PNG_BASE64);

  const slot = await slotResponse;
  const upload = await uploadResponse;
  expect(slot.ok(), await slot.text()).toBe(true);
  expect(upload.ok(), await upload.text()).toBe(true);
  await expect(page.locator('.attachment-draft-list')).toContainText('Готово', { timeout: 30_000 });

  await input.press('Enter');
  await expect(page.locator('.attachment-mosaic img').last()).toBeVisible({ timeout: 30_000 });
});
