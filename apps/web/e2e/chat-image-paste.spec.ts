import { expect, test } from '@playwright/test';
import { registerViaUi, uniqueLogin } from './helpers';

const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAACXBIWXMAAAPoAAAD6AG1e1JrAAAARUlEQVRYhe3XsREAMAhC0YzIOIzoVmaLpHmFvXcifE4z+3OOBeoEIcLxhsuIyoojjEYcLyApJAsoHVi+iklVsyin81wHF4vcPJcf4sTZAAAAAElFTkSuQmCC';

test('image attachments support picker, removal, drag-and-drop, paste, and sending', async ({ page }) => {
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
  const addButton = page.getByRole('button', { name: 'Добавить вложение' });
  await expect(addButton).toBeVisible();
  const composeField = page.locator('.attachment-compose-field');
  await expect(composeField).toBeVisible();
  const [fieldBox, addBox] = await Promise.all([composeField.boundingBox(), addButton.boundingBox()]);
  expect(fieldBox).not.toBeNull();
  expect(addBox).not.toBeNull();
  expect(addBox!.x).toBeGreaterThanOrEqual(fieldBox!.x);
  expect(addBox!.x + addBox!.width).toBeLessThanOrEqual(fieldBox!.x + fieldBox!.width);

  await input.focus();
  await expect.poll(() => composeField.evaluate((element) => getComputedStyle(element).borderColor))
    .toBe('rgba(255, 255, 255, 0.72)');

  await page.route('**/api/media/attachments/*/content', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 500));
    await route.continue();
  });

  const pickerUpload = page.waitForResponse((response) =>
    /\/api\/media\/attachments\/[^/]+\/content$/.test(response.url())
      && response.request().method() === 'PUT'
  );
  await addButton.click();
  const fileChooser = page.waitForEvent('filechooser');
  await page.getByRole('menuitem', { name: 'Загрузить фото' }).click();
  await (await fileChooser).setFiles({
    name: 'picker.png',
    mimeType: 'image/png',
    buffer: Buffer.from(PNG_BASE64, 'base64')
  });
  await expect(page.locator('.attachment-draft img')).toBeVisible();
  await expect(page.locator('.attachment-draft-loading')).toBeVisible();
  expect((await pickerUpload).ok()).toBe(true);
  await expect(page.locator('.attachment-draft')).toHaveAttribute('data-state', 'ready', { timeout: 30_000 });

  const thumbnail = page.locator('.attachment-draft');
  await thumbnail.hover();
  const removeButton = page.getByRole('button', { name: 'Удалить изображение 1' });
  await expect(removeButton).toBeVisible();
  const deleteResponse = page.waitForResponse((response) =>
    /\/api\/media\/attachments\/[^/]+$/.test(response.url())
      && response.request().method() === 'DELETE'
  );
  await removeButton.click();
  expect((await deleteResponse).ok()).toBe(true);
  await expect(thumbnail).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Переместить раньше' })).toHaveCount(0);
  await expect(page.getByText('Удалить', { exact: true })).toHaveCount(0);

  const slotResponse = page.waitForResponse((response) =>
    response.url().endsWith('/api/media/attachments')
      && response.request().method() === 'POST'
  );
  const uploadResponse = page.waitForResponse((response) =>
    /\/api\/media\/attachments\/[^/]+\/content$/.test(response.url())
      && response.request().method() === 'PUT'
  );

  const chat = page.getByRole('complementary', { name: 'Чат комнаты' });
  await chat.evaluate((element, encoded) => {
    const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], 'dropped.png', { type: 'image/png' }));
    (window as typeof window & { __attachmentTestTransfer?: DataTransfer }).__attachmentTestTransfer = transfer;
    element.dispatchEvent(new DragEvent('dragenter', {
      bubbles: true,
      cancelable: true,
      dataTransfer: transfer
    }));
  }, PNG_BASE64);
  await expect(page.getByText('Перетащите фото сюда')).toBeVisible();
  await chat.evaluate((element) => {
    const transfer = (window as typeof window & { __attachmentTestTransfer?: DataTransfer }).__attachmentTestTransfer;
    element.dispatchEvent(new DragEvent('drop', {
      bubbles: true,
      cancelable: true,
      dataTransfer: transfer
    }));
  });
  await expect(page.getByText('Перетащите фото сюда')).toHaveCount(0);

  const slot = await slotResponse;
  const upload = await uploadResponse;
  expect(slot.ok(), await slot.text()).toBe(true);
  expect(upload.ok(), await upload.text()).toBe(true);
  await expect(page.locator('.attachment-draft')).toHaveAttribute('data-state', 'ready', { timeout: 30_000 });

  await input.press('Enter');
  await expect(page.locator('.attachment-mosaic img').last()).toBeVisible({ timeout: 30_000 });

  const pasteSlot = page.waitForResponse((response) =>
    response.url().endsWith('/api/media/attachments')
      && response.request().method() === 'POST'
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
  expect((await pasteSlot).ok()).toBe(true);
  await expect(page.locator('.attachment-draft')).toBeVisible();
});
