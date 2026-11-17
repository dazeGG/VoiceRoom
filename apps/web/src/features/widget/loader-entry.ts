import { mountWidget } from './loader';

const origin = new URL(import.meta.url).origin;
for (const container of document.querySelectorAll<HTMLElement>('[data-voiceroom-widget]:not([data-mounted])')) {
  try {
    mountWidget(container, origin);
    container.dataset.mounted = 'true';
  } catch {
    container.textContent = 'Не удалось загрузить VoiceRoom: проверьте настройки виджета.';
  }
}
