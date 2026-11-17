import { render, screen, fireEvent } from '@testing-library/vue';
import { expect, test, vi } from 'vitest';
import { decodeWidgetConfig } from '@voice-room/shared/contracts/widget';
import WidgetsPage from '../src/pages/WidgetsPage.vue';
test('anonymous configurator produces validated snippets with inert preview', async () => {
  const fetchSpy = vi.spyOn(globalThis, 'fetch');
  try {
    const view = render(WidgetsPage);
    await fireEvent.update(screen.getByLabelText('Размещение'), 'floating');
    await fireEvent.update(screen.getByLabelText('Ширина'), '480');
    await fireEvent.click(screen.getByLabelText('Текстовый чат'));
    const field = screen.getByLabelText('Код вставки');
    if (!(field instanceof HTMLTextAreaElement)) throw new Error('Missing snippet field');
    const parsed = new DOMParser().parseFromString(field.value, 'text/html');
    const config = parsed.querySelector('[data-config]')?.getAttribute('data-config');
    if (!config) throw new Error('Missing encoded config');
    expect(decodeWidgetConfig(decodeURIComponent(config))).toMatchObject({ mode: 'floating', width: 480, chat: true });
    expect(parsed.querySelector('script')?.type).toBe('module');
    expect(document.querySelector('iframe')).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(screen.getByText('Предпросмотр: камера и микрофон не включаются.').isConnected).toBe(true);
    view.unmount();
  } finally {
    fetchSpy.mockRestore();
  }
});
