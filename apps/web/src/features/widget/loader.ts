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
  const floatingWidth = `min(${config.width}px,calc(100vw - ${2 * config.offset}px))`;
  const frameHeight =
    config.mode === 'floating'
      ? `min(${config.height}px,max(0px,calc(100dvh - ${2 * config.offset + 60}px)))`
      : `min(${config.height}px,100dvh)`;
  frame.style.cssText = `--vr-bg:${config.background};display:block;flex:none;box-sizing:border-box;border:0;width:min(${config.width}px,100%);height:${frameHeight};border-radius:${config.radius}px;background:var(--vr-bg);pointer-events:auto;`;
  const launcher = document.createElement('button');
  launcher.type = 'button';
  launcher.textContent = 'VoiceRoom';
  launcher.setAttribute('aria-expanded', 'true');
  launcher.hidden = config.mode !== 'floating';
  launcher.style.cssText = `--vr-bg:${config.background};--vr-text:${config.text};--vr-accent:${config.accent};display:${config.mode === 'floating' ? 'inline-flex' : 'none'};box-sizing:border-box;align-items:center;justify-content:center;min-height:48px;max-width:100%;padding:0 16px;border:1px solid color-mix(in srgb,var(--vr-text) 12%,transparent);border-radius:999px;background:var(--vr-bg);color:var(--vr-text);font:600 13px/1.2 Onest,system-ui,sans-serif;overflow-wrap:anywhere;cursor:pointer;touch-action:manipulation;pointer-events:auto;outline-color:var(--vr-accent);outline-offset:3px;`;
  let collapsed = false;
  const collapse = (next: boolean) => {
    collapsed = next;
    frame.inert = next;
    frame.style.visibility = next ? 'hidden' : 'visible';
    frame.style.position = next ? 'absolute' : 'relative';
    frame.style.pointerEvents = next ? 'none' : 'auto';
    if (config.mode === 'floating') container.style.width = next ? 'max-content' : floatingWidth;
    launcher.setAttribute('aria-expanded', String(!next));
    if (next) launcher.focus();
    else frame.focus();
  };
  launcher.addEventListener('click', () => collapse(!collapsed));
  if (config.mode === 'floating') {
    const [vertical, horizontal] = config.corner.split('-');
    container.style.cssText = `position:fixed;${vertical}:${config.offset}px;${horizontal}:${config.offset}px;display:flex;flex-direction:column;align-items:${horizontal === 'right' ? 'flex-end' : 'flex-start'};gap:12px;width:${floatingWidth};max-width:calc(100vw - ${2 * config.offset}px);box-sizing:border-box;pointer-events:none;z-index:2147483000;`;
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
  container.append(frame, launcher);
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
