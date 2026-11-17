import {
  decodeWidgetConfig,
  encodeWidgetConfig,
  parseWidgetMessage,
  widgetOrigin
} from '@voice-room/shared/contracts/widget';

export function mountWidget(container: HTMLElement, serviceOrigin: string): () => void {
  const config = decodeWidgetConfig(decodeURIComponent(container.dataset.config ?? ''));
  const origin = widgetOrigin(serviceOrigin);
  const parentOrigin = widgetOrigin(window.location.origin);
  const nonce = Array.from(crypto.getRandomValues(new Uint8Array(24)), (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('');
  const frame = document.createElement('iframe');
  frame.title = 'VoiceRoom';
  frame.allow = 'microphone; camera; autoplay';
  frame.referrerPolicy = 'no-referrer';
  const fragment = new URLSearchParams({ config: encodeWidgetConfig(config), parentOrigin, nonce });
  frame.src = `${origin}/embed/v1#${fragment}`;
  frame.style.cssText = `border:0;width:min(${config.width}px,100%);height:min(${config.height}px,100dvh);border-radius:${config.radius}px;`;
  const launcher = document.createElement('button');
  launcher.type = 'button';
  launcher.textContent = 'VoiceRoom';
  launcher.setAttribute('aria-expanded', 'true');
  launcher.hidden = config.mode !== 'floating';
  let collapsed = false;
  const collapse = (next: boolean) => {
    collapsed = next;
    frame.inert = next;
    frame.style.visibility = next ? 'hidden' : 'visible';
    frame.style.position = next ? 'absolute' : 'relative';
    launcher.setAttribute('aria-expanded', String(!next));
    if (next) launcher.focus();
    else frame.focus();
  };
  launcher.addEventListener('click', () => collapse(!collapsed));
  if (config.mode === 'floating') {
    const [vertical, horizontal] = config.corner.split('-');
    container.style.cssText = `position:fixed;${vertical}:${config.offset}px;${horizontal}:${config.offset}px;max-width:calc(100vw - ${2 * config.offset}px);z-index:2147483000;`;
  }
  const receive = (event: MessageEvent<unknown>) => {
    if (event.source !== frame.contentWindow || event.origin !== origin) return;
    const message = parseWidgetMessage(event.data);
    if (!message || message.nonce !== nonce) return;
    if (message.type === 'ready') frame.contentWindow?.postMessage({ version: 1, type: 'initialize', nonce }, origin);
    if (message.type === 'requestCollapse' && config.mode === 'floating') collapse(true);
    if (message.type === 'callState') launcher.textContent = message.active ? 'VoiceRoom • В звонке' : 'VoiceRoom';
  };
  window.addEventListener('message', receive);
  container.append(launcher, frame);
  let disposed = false;
  const observer = new MutationObserver(() => {
    if (!container.isConnected) dispose();
  });
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    observer.disconnect();
    window.removeEventListener('message', receive);
    frame.remove();
    launcher.remove();
  };
  observer.observe(document.documentElement, { childList: true, subtree: true });
  return dispose;
}
