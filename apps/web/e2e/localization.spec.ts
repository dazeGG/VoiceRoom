import { expect, test } from '@playwright/test';
import { registerViaUi, uniqueLogin } from './helpers';

test.describe('French first launch and saved browser choice', () => {
  test.use({ locale: 'fr-CA' });

  test('guest controls, active API failures and reload follow the selected language', async ({ page }) => {
    await page.route('**/api/auth/login', (route) =>
      route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ ok: false, error: 'legacy server text', code: 'invalid_credentials' })
      })
    );
    await page.goto('/login');
    await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
    const dialog = page.getByRole('dialog');
    const language = dialog.getByRole('combobox');
    await expect(language).toHaveValue('fr');
    await language.selectOption('en');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await page.locator('#authLoginInput').fill('localization-user');
    await page.locator('#authPasswordInput').fill('wrong-password');
    await dialog.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(dialog.getByRole('alert')).toContainText('Invalid username or password');
    await language.selectOption('fr');
    await expect(dialog.getByRole('alert')).not.toContainText('Invalid username or password');
    await expect(dialog.getByRole('alert')).not.toContainText('legacy server text');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
    await expect(page.getByRole('dialog').getByRole('combobox')).toHaveValue('fr');
  });
});

test.describe('unsupported browser language', () => {
  test.use({ locale: 'de-DE' });

  test('uses Russian before a manual English choice', async ({ page }) => {
    await page.goto('/login');
    await expect(page.locator('html')).toHaveAttribute('lang', 'ru');
    const language = page.getByRole('dialog').getByRole('combobox');
    await expect(language).toHaveValue('ru');
    await language.selectOption('en');
    await expect(page.getByRole('dialog').getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  });
});

test('authenticated settings labels update without closing and persist on reload', async ({ page }) => {
  await registerViaUi(page, uniqueLogin('locale'));
  await page.getByRole('button', { name: 'Открыть настройки', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Внешний вид', exact: true }).click();
  const settings = page.getByRole('dialog');
  await settings.getByRole('combobox').selectOption('en');
  await expect(settings).toHaveAccessibleName('Settings');
  await expect(settings.getByRole('button', { name: 'Profile', exact: true })).toBeVisible();
  await settings.getByRole('combobox').selectOption('fr');
  await expect(settings).toHaveAccessibleName('Paramètres');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
});

test.describe('French narrow layouts', () => {
  test.use({ locale: 'fr-FR' });

  test('language controls and the sign-in form fit narrow widths', async ({ page }) => {
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 844 });
      await page.goto('/login');
      await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
      await expect(page.getByRole('dialog').getByRole('combobox')).toHaveValue('fr');
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      await expect(page.getByRole('dialog').getByRole('button', { name: 'Se connecter', exact: true })).toBeVisible();
    }
    await page.screenshot({ path: '../../.omx/ultragoal/evidence-web-fr-390.png', fullPage: true });
  });
});

test('guest sign-in stays at the header edge and language remains available below the content', async ({ page }) => {
  for (const width of [1280, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/app');
    const login = page.locator('.landing__login');
    await expect(login).toBeVisible();
    const header = await page.locator('.topbar').boundingBox();
    const action = await login.boundingBox();
    expect(header).not.toBeNull();
    expect(action).not.toBeNull();
    if (!header || !action) throw new Error('Guest header is not rendered');
    expect(Math.abs(action.x + action.width - header.x - header.width)).toBeLessThan(2);
    const language = page.getByRole('contentinfo').getByRole('combobox');
    const picker = await language.boundingBox();
    const iconControl = await page.locator('.landing__legal .language-control').boundingBox();
    if (!picker || !iconControl) throw new Error('Guest language icon is not rendered');
    expect(picker.width).toBeLessThanOrEqual(iconControl.width);
    await language.selectOption('fr');
    await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
    await expect(page.locator('.language-control__icon')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await login.click();
    const dialog = page.getByRole('dialog');
    const form = await dialog.locator('form').boundingBox();
    const choice = await dialog.getByRole('combobox').boundingBox();
    if (!form || !choice) throw new Error('Sign-in form language control is not rendered');
    expect(choice.y).toBeGreaterThanOrEqual(form.y + form.height);
    await dialog.getByRole('combobox').selectOption('en');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(dialog.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
    await expect(dialog.getByRole('combobox')).toHaveCSS('min-height', '44px');
  }
});
