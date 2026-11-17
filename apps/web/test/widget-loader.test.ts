import { afterEach, describe, expect, it } from 'vitest';
import { defaultWidgetConfig, encodeWidgetConfig } from '@voice-room/shared/contracts/widget';
import { mountWidget } from '../src/features/widget/loader';
import { widgetSnippet } from '../src/features/widget/snippet';
const disposals: (() => void)[] = [];
afterEach(() => {
  disposals.splice(0).forEach((dispose) => dispose());
  document.body.replaceChildren();
});
function create() {
  const host = document.createElement('div');
  host.dataset.config = encodeURIComponent(encodeWidgetConfig({ ...defaultWidgetConfig, mode: 'floating' }));
  document.body.append(host);
  disposals.push(mountWidget(host, 'https://voice.test'));
  const frame = host.querySelector('iframe');
  const button = host.querySelector('button');
  if (!frame || !button) throw new Error('Widget elements missing');
  return { host, frame, button };
}
describe('widget loader', () => {
  it('creates independent instances without capture delegation beyond mic/camera and retains frame on collapse', () => {
    const a = create();
    const b = create();
    const nonceA = new URL(a.frame.src).hash;
    expect(nonceA).not.toBe(new URL(b.frame.src).hash);
    expect(a.frame.allow).not.toContain('display-capture');
    expect(a.frame.referrerPolicy).toBe('no-referrer');
    for (let i = 0; i < 10; i++) {
      a.button.click();
      a.button.click();
    }
    expect(a.host.querySelector('iframe')).toBe(a.frame);
    expect(a.frame.style.visibility).toBe('visible');
  });
  it('rejects wrong source, origin and nonce before acting on collapse', () => {
    const a = create();
    const b = create();
    const nonce = new URLSearchParams(new URL(a.frame.src).hash.slice(1)).get('nonce');
    const data = { version: 1, nonce, type: 'requestCollapse' };
    for (const event of [
      new MessageEvent('message', { origin: 'https://evil.test', source: a.frame.contentWindow, data }),
      new MessageEvent('message', { origin: 'https://voice.test', source: b.frame.contentWindow, data }),
      new MessageEvent('message', {
        origin: 'https://voice.test',
        source: a.frame.contentWindow,
        data: { ...data, nonce: 'ff'.repeat(24) }
      })
    ])
      window.dispatchEvent(event);
    expect(a.frame.style.visibility).not.toBe('hidden');
    window.dispatchEvent(
      new MessageEvent('message', { origin: 'https://voice.test', source: a.frame.contentWindow, data })
    );
    expect(a.frame.style.visibility).toBe('hidden');
    expect(b.frame.style.visibility).not.toBe('hidden');
  });
  it('disposal removes frame and snippet encodes configuration as data', () => {
    const a = create();
    const dispose = disposals.pop();
    if (!dispose) throw new Error('Missing disposal');
    dispose();
    expect(a.host.children).toHaveLength(0);
    expect(widgetSnippet(defaultWidgetConfig, 'https://voice.test')).toContain('type="module"');
    expect(() => widgetSnippet(defaultWidgetConfig, 'null')).toThrow();
  });
});
