import '@voice-room/ui/styles/tokens';
import '@voice-room/ui/styles/typography';
import '@/styles/widget/_shell.scss';
import { createApp } from 'vue';
import { parseWidgetBootstrap, parseWidgetMessage } from '@voice-room/shared/contracts/widget';
import WidgetShell from './WidgetShell.vue';
const mount = document.getElementById('widget');
try {
  if (!mount) throw new Error('Не найден контейнер VoiceRoom');
  const bootstrap = parseWidgetBootstrap(location.hash);
  const app = createApp(WidgetShell, { bootstrap });
  let initialized = false;
  const initialize = (event: MessageEvent<unknown>) => {
    if (event.source !== parent || event.origin !== bootstrap.parentOrigin) return;
    const message = parseWidgetMessage(event.data);
    if (!message || message.type !== 'initialize' || message.nonce !== bootstrap.nonce || initialized) return;
    initialized = true;
    app.mount(mount);
  };
  window.addEventListener('message', initialize);
  parent.postMessage({ version: 1, nonce: bootstrap.nonce, type: 'ready' }, bootstrap.parentOrigin);
  window.addEventListener(
    'pagehide',
    () => {
      window.removeEventListener('message', initialize);
      if (initialized) app.unmount();
    },
    { once: true }
  );
} catch (error) {
  if (mount) mount.textContent = error instanceof Error ? error.message : 'Неверные настройки VoiceRoom';
}
