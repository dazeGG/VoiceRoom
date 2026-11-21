import { render, screen, fireEvent, waitFor, within } from '@testing-library/vue';
import { beforeEach, expect, test, vi } from 'vitest';
import { decodeWidgetEmbedConfig } from '@voice-room/shared/contracts/widget';
import WidgetsPage from '../src/pages/WidgetsPage.vue';

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    }
  );
});

function snippetField() {
  const field = screen.getByRole('textbox', { name: 'Код вставки' });
  if (!(field instanceof HTMLTextAreaElement)) throw new Error('Missing snippet field');
  return field;
}
function snippetConfig() {
  const parsed = new DOMParser().parseFromString(snippetField().value, 'text/html');
  const config = parsed.querySelector('[data-config]')?.getAttribute('data-config');
  if (!config) throw new Error('Missing encoded config');
  return decodeWidgetEmbedConfig(config);
}
function numericField(name: string) {
  return screen.getByRole('spinbutton', { name });
}
function slider(name: string) {
  return screen.getByRole('slider', { name });
}

test('anonymous configurator updates every supported setting without starting its inert preview', async () => {
  const fetchSpy = vi.spyOn(globalThis, 'fetch');
  try {
    render(WidgetsPage);
    await fireEvent.click(screen.getByRole('radio', { name: 'Плавающая панель' }));
    await fireEvent.keyDown(slider('Ширина'), { key: 'Home' });
    await fireEvent.keyDown(slider('Высота'), { key: 'End' });
    await fireEvent.keyDown(slider('Скругление'), { key: 'End' });
    await fireEvent.update(numericField('Отступ, px'), '24');
    await fireEvent.update(screen.getByLabelText('Положение'), 'top-left');
    await fireEvent.update(screen.getByLabelText('Заголовок виджета'), `Клуб 'Бэнг' & "ДнД" <3 • 100% голосом`);
    await fireEvent.update(screen.getByLabelText('Фон (HEX или RGB)'), 'rgb(16, 24, 32)');
    await fireEvent.update(screen.getByLabelText('Текст'), '#f5f5f5');
    await fireEvent.update(screen.getByLabelText('Акцент'), '#aad500');

    expect(snippetConfig()).toEqual({
      version: 1,
      title: `Клуб 'Бэнг' & "ДнД" <3 • 100% голосом`,
      mode: 'floating',
      width: 280,
      height: 900,
      radius: 24,
      offset: 24,
      corner: 'top-left',
      background: '#101820',
      text: '#f5f5f5',
      accent: '#aad500'
    });
    const parsed = new DOMParser().parseFromString(snippetField().value, 'text/html');
    expect(parsed.querySelector('script')?.type).toBe('module');
    expect(parsed.querySelector('script')?.src).toBe('https://voiceroom.ru/widget/v1/loader.js');
    expect(document.querySelector('iframe')).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    const preview = screen.getByRole('region', { name: 'Предпросмотр' });
    const card = preview.querySelector('.widget-shell');
    if (!(card instanceof HTMLElement)) throw new Error('Missing preview card');
    expect(card.querySelector('.widget-shell__body')?.hasAttribute('inert')).toBe(true);
    expect(card.querySelector('h1')?.textContent).toBe(snippetConfig().title);
    expect(within(preview).getByRole('link', { name: 'VoiceRoom' }).getAttribute('href')).toBe('https://voiceroom.ru/');
    expect(card.style.width).toBe('280px');
    expect(card.style.height).toBe('900px');
    expect(card.style.borderRadius).toBe('24px');
    expect(slider('Ширина').getAttribute('aria-valuetext')).toBe('280 px');
    expect(within(preview).queryByRole('slider', { name: 'Ширина' })).toBeNull();
    expect(within(preview).queryByRole('slider', { name: 'Высота' })).toBeNull();
    expect(card.style.getPropertyValue('--vr-accent')).toBe('#aad500');
    for (const input of card.querySelectorAll('input')) expect(input.disabled).toBe(true);
    for (const button of card.querySelectorAll('button')) expect(button.disabled).toBe(true);
    expect(screen.getByText(/Камера и микрофон выключены/).closest('[inert]')).toBeNull();
    expect(screen.queryByRole('switch', { name: 'Текстовый чат' })).toBeNull();
  } finally {
    fetchSpy.mockRestore();
  }
});

test('inline preview dimensions and floating panel dimensions stay independent when switching placement', async () => {
  render(WidgetsPage);
  expect(screen.queryByLabelText('Положение')).toBeNull();
  expect(screen.queryByRole('spinbutton', { name: 'Отступ, px' })).toBeNull();
  await fireEvent.keyDown(await screen.findByRole('slider', { name: 'Ширина' }), { key: 'Home' });
  await fireEvent.click(screen.getByRole('radio', { name: 'Плавающая панель' }));
  expect(snippetConfig()).toMatchObject({ width: 360, height: 520 });
  await fireEvent.keyDown(await screen.findByRole('slider', { name: 'Ширина' }), { key: 'End' });
  await fireEvent.update(screen.getByLabelText('Положение'), 'top-right');
  await fireEvent.update(numericField('Отступ, px'), '32');
  await fireEvent.blur(numericField('Отступ, px'));
  await fireEvent.click(screen.getByRole('radio', { name: 'Внутри страницы' }));
  expect(screen.queryByLabelText('Положение')).toBeNull();
  expect(snippetConfig()).toMatchObject({ mode: 'inline', corner: 'top-right', offset: 32 });
  expect(snippetConfig().width).toBeUndefined();
  expect(snippetConfig().height).toBeUndefined();
  expect((await screen.findByRole('slider', { name: 'Ширина' })).getAttribute('aria-valuenow')).toBe('240');
  await fireEvent.click(screen.getByRole('radio', { name: 'Плавающая панель' }));
  expect(screen.getByLabelText('Положение')).toHaveProperty('value', 'top-right');
  expect(numericField('Отступ, px')).toHaveProperty('value', '32');
  expect(snippetConfig()).toMatchObject({ width: 960, height: 520 });
});

test('the camera switch exports an explicit opt-out and removes the preview camera controls', async () => {
  render(WidgetsPage);
  await fireEvent.click(screen.getByRole('radio', { name: 'В комнате' }));
  expect(screen.getByRole('button', { name: 'Выбрать камеру' })).toBeTruthy();
  await fireEvent.click(screen.getByRole('switch', { name: 'Камера' }));
  expect(snippetConfig().camera).toBe(false);
  expect(screen.queryByRole('button', { name: 'Выбрать камеру' })).toBeNull();
  await fireEvent.click(screen.getByRole('switch', { name: 'Камера' }));
  expect(snippetConfig().camera).toBeUndefined();
});

test('invalid embed settings explain the accepted range and prevent copying an invalid snippet', async () => {
  render(WidgetsPage);
  await fireEvent.click(screen.getByRole('radio', { name: 'Плавающая панель' }));
  await fireEvent.update(numericField('Отступ, px'), '49');
  expect(screen.queryByRole('alert')).toBeNull();
  await fireEvent.focusOut(numericField('Отступ, px'));
  expect(screen.getByRole('alert').textContent).toContain('0–48 px');
  expect(snippetField().value).toBe('');
  expect(screen.getByRole('button', { name: 'Скопировать код' })).toHaveProperty('disabled', true);
  await fireEvent.update(numericField('Отступ, px'), '16');
  expect(screen.queryByRole('alert')).toBeNull();
});

test('demo size and participant count change the room preview without changing the embed', async () => {
  render(WidgetsPage);
  const snippet = snippetField().value;
  const height = await screen.findByRole('slider', { name: 'Высота' });
  expect(height.getAttribute('aria-valuenow')).toBe('400');
  await fireEvent.keyDown(height, { key: 'Home' });
  await fireEvent.click(screen.getByRole('radio', { name: 'В комнате' }));
  await fireEvent.keyDown(await screen.findByRole('slider', { name: 'Участников' }), { key: 'End' });
  const card = screen.getByRole('region', { name: 'Предпросмотр' }).querySelector('.widget-shell');
  if (!(card instanceof HTMLElement)) throw new Error('Missing preview card');
  expect(card.style.height).toBe('260px');
  expect(card.querySelectorAll('li')).toHaveLength(12);
  expect(card.querySelector('.widget-call__code')?.textContent).toMatch(/^[abcdefghijkmnpqrstuvwxyz23456789]{10}$/);
  expect(within(card).getByRole('group', { name: 'Управление звонком' })).toBeTruthy();
  expect(snippetField().value).toBe(snippet);
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.getByRole('button', { name: 'Скопировать код' })).toHaveProperty('disabled', false);
});

test('copy action writes the current snippet and a settings change clears stale success', async () => {
  const writeText = vi.fn(async () => {});
  vi.stubGlobal('navigator', Object.create(navigator, { clipboard: { value: { writeText } } }));
  render(WidgetsPage);
  const original = snippetField().value;
  const copy = screen.getByRole('button', { name: 'Скопировать код' });
  expect(copy.textContent?.trim()).toBe('');
  await fireEvent.click(copy);
  await waitFor(() => expect(copy.getAttribute('title')).toBe('Скопировано'));
  expect(writeText).toHaveBeenCalledWith(original);
  await fireEvent.keyDown(slider('Скругление'), { key: 'End' });
  expect(copy.getAttribute('title')).toBe('Скопировать код');
  await fireEvent.click(copy);
  await waitFor(() => expect(writeText).toHaveBeenLastCalledWith(snippetField().value));
  expect(snippetField().value).not.toBe(original);
});

test('clipboard denial selects the complete snippet and provides a manual copy path', async () => {
  vi.stubGlobal(
    'navigator',
    Object.create(navigator, { clipboard: { value: { writeText: () => Promise.reject(new Error('denied')) } } })
  );
  render(WidgetsPage);
  await fireEvent.click(screen.getByRole('button', { name: 'Скопировать код' }));
  await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Код выделен'));
  const field = snippetField();
  expect(document.activeElement).toBe(field);
  expect(field.selectionStart).toBe(0);
  expect(field.selectionEnd).toBe(field.value.length);
});
