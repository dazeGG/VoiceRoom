import { render, screen, fireEvent, waitFor } from '@testing-library/vue';
import { expect, test, vi } from 'vitest';
import { decodeWidgetConfig } from '@voice-room/shared/contracts/widget';
import WidgetsPage from '../src/pages/WidgetsPage.vue';

function snippetField() {
  const field = screen.getByLabelText('Код вставки');
  if (!(field instanceof HTMLTextAreaElement)) throw new Error('Missing snippet field');
  return field;
}
function snippetConfig() {
  const parsed = new DOMParser().parseFromString(snippetField().value, 'text/html');
  const config = parsed.querySelector('[data-config]')?.getAttribute('data-config');
  if (!config) throw new Error('Missing encoded config');
  return decodeWidgetConfig(decodeURIComponent(config));
}
function numericField(name: string) {
  return screen.getByRole('spinbutton', { name });
}

test('anonymous configurator updates every supported setting without starting its inert preview', async () => {
  const fetchSpy = vi.spyOn(globalThis, 'fetch');
  try {
    render(WidgetsPage);
    await fireEvent.click(screen.getByRole('radio', { name: 'Плавающая панель' }));
    await fireEvent.update(numericField('Ширина'), '480');
    await fireEvent.update(numericField('Высота'), '640');
    await fireEvent.update(numericField('Скругление'), '20');
    await fireEvent.update(numericField('Отступ'), '24');
    await fireEvent.update(screen.getByLabelText('Положение'), 'top-left');
    await fireEvent.update(screen.getByLabelText('Фон'), '#101820');
    await fireEvent.update(screen.getByLabelText('Текст'), '#f5f5f5');
    await fireEvent.update(screen.getByLabelText('Акцент'), '#aad500');
    await fireEvent.click(screen.getByRole('switch', { name: 'Текстовый чат' }));

    expect(snippetConfig()).toEqual({
      version: 1,
      mode: 'floating',
      width: 480,
      height: 640,
      radius: 20,
      offset: 24,
      corner: 'top-left',
      background: '#101820',
      text: '#f5f5f5',
      accent: '#aad500',
      chat: true
    });
    const parsed = new DOMParser().parseFromString(snippetField().value, 'text/html');
    expect(parsed.querySelector('script')?.type).toBe('module');
    expect(document.querySelector('iframe')).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    const preview = screen.getByRole('region', { name: 'Предпросмотр' });
    const card = preview.querySelector('.widget-shell');
    if (!(card instanceof HTMLElement)) throw new Error('Missing preview card');
    expect(card.hasAttribute('inert')).toBe(true);
    expect(card.style.minHeight).toBe('640px');
    expect(card.style.borderRadius).toBe('20px');
    expect(card.style.getPropertyValue('--vr-accent')).toBe('#aad500');
    for (const input of preview.querySelectorAll('input')) expect(input.disabled).toBe(true);
    for (const button of preview.querySelectorAll('button')) expect(button.disabled).toBe(true);
    expect(screen.getByText('Предпросмотр: камера и микрофон не включаются.').closest('[inert]')).toBeNull();
    expect(screen.getByText('Текстовый чат доступен в комнате')).toBeTruthy();
  } finally {
    fetchSpy.mockRestore();
  }
});

test('inline placement hides irrelevant corner controls without losing their configured values', async () => {
  render(WidgetsPage);
  expect(screen.queryByLabelText('Положение')).toBeNull();
  expect(screen.queryByLabelText('Отступ')).toBeNull();
  await fireEvent.click(screen.getByRole('radio', { name: 'Плавающая панель' }));
  await fireEvent.update(screen.getByLabelText('Положение'), 'top-right');
  await fireEvent.update(numericField('Отступ'), '32');
  await fireEvent.click(screen.getByRole('radio', { name: 'Внутри страницы' }));
  expect(screen.queryByLabelText('Положение')).toBeNull();
  expect(snippetConfig()).toMatchObject({ mode: 'inline', corner: 'top-right', offset: 32 });
  await fireEvent.click(screen.getByRole('radio', { name: 'Плавающая панель' }));
  expect(screen.getByLabelText('Положение')).toHaveProperty('value', 'top-right');
  expect(numericField('Отступ')).toHaveProperty('value', '32');
});

test('invalid dimensions explain the accepted range and prevent copying an invalid snippet', async () => {
  render(WidgetsPage);
  await fireEvent.update(numericField('Ширина'), '200');
  expect(screen.queryByRole('alert')).toBeNull();
  await fireEvent.focusOut(numericField('Ширина'));
  expect(screen.getByRole('alert').textContent).toContain('280–960 px');
  expect(snippetField().value).toBe('');
  expect(screen.getByRole('button', { name: 'Скопировать код' })).toHaveProperty('disabled', true);
  await fireEvent.update(numericField('Ширина'), '400');
  expect(screen.queryByRole('alert')).toBeNull();
});

test('the shortest supported height is reflected in the preview and remains valid for embedding', async () => {
  render(WidgetsPage);
  await fireEvent.update(numericField('Высота'), '320');
  expect(snippetConfig().height).toBe(320);
  const card = screen.getByRole('region', { name: 'Предпросмотр' }).querySelector('.widget-shell');
  if (!(card instanceof HTMLElement)) throw new Error('Missing preview card');
  expect(card.style.height).toBe('320px');
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.getByRole('button', { name: 'Скопировать код' })).toHaveProperty('disabled', false);
});

test('copy action writes the current snippet and a settings change clears stale success', async () => {
  const writeText = vi.fn(async () => {});
  vi.stubGlobal('navigator', Object.create(navigator, { clipboard: { value: { writeText } } }));
  render(WidgetsPage);
  const original = snippetField().value;
  await fireEvent.click(screen.getByRole('button', { name: 'Скопировать код' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Скопировано' })).toBeTruthy());
  expect(writeText).toHaveBeenCalledWith(original);
  await fireEvent.update(numericField('Ширина'), '400');
  expect(screen.queryByRole('button', { name: 'Скопировано' })).toBeNull();
  await fireEvent.click(screen.getByRole('button', { name: 'Скопировать код' }));
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
