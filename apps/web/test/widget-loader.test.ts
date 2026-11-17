import { afterEach, describe, expect, it } from 'vitest';
import { defaultWidgetConfig, encodeWidgetConfig, type WidgetConfig } from '@voice-room/shared/contracts/widget';
import { mountWidget } from '../src/features/widget/loader';
import { widgetSnippet } from '../src/features/widget/snippet';
const disposals: (() => void)[] = [];
afterEach(() => {
  disposals.splice(0).forEach((dispose) => dispose());
  document.body.replaceChildren();
});
function create(overrides: Partial<WidgetConfig> = {}) {
  const host = document.createElement('div');
  host.dataset.config = encodeURIComponent(
    encodeWidgetConfig({ ...defaultWidgetConfig, mode: 'floating', ...overrides })
  );
  document.body.append(host);
  disposals.push(mountWidget(host, 'https://voice.test'));
  const frame = host.querySelector('iframe');
  const button = host.querySelector('button');
  if (!frame || !button) throw new Error('Widget elements missing');
  return { host, frame, button };
}
describe('widget loader', () => {
  it('keeps the floating launcher below its frame and leaves the surrounding host clickable', () => {
    const { host, frame, button } = create({
      corner: 'top-left',
      offset: 24,
      width: 960,
      height: 900,
      background: '#223344',
      text: '#f0f1f2',
      accent: '#ccef33'
    });
    expect([...host.children]).toEqual([frame, button]);
    expect(host.style.display).toBe('flex');
    expect(host.style.flexDirection).toBe('column');
    expect(host.style.alignItems).toBe('flex-start');
    expect(host.style.top).toBe('24px');
    expect(host.style.left).toBe('24px');
    const expandedWidth = host.style.width;
    expect(expandedWidth).toContain('960px');
    expect(expandedWidth).toContain('100vw');
    expect(expandedWidth).toContain('48px');
    expect(frame.style.height).toContain('100dvh');
    expect(frame.style.height).toContain('108px');
    expect(button.style.minHeight).toBe('48px');
    expect(button.style.getPropertyValue('--vr-bg')).toBe('#223344');
    expect(button.style.getPropertyValue('--vr-text')).toBe('#f0f1f2');
    expect(button.style.getPropertyValue('--vr-accent')).toBe('#ccef33');
    expect(host.style.pointerEvents).toBe('none');
    expect(frame.style.pointerEvents).toBe('auto');
    expect(button.style.pointerEvents).toBe('auto');
    button.click();
    expect(host.querySelector('iframe')).toBe(frame);
    expect(frame.inert).toBe(true);
    expect(frame.style.position).toBe('absolute');
    expect(frame.style.pointerEvents).toBe('none');
    expect(host.style.width).toBe('max-content');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(button);
    button.click();
    expect(frame.inert).toBe(false);
    expect(frame.style.pointerEvents).toBe('auto');
    expect(host.style.width).toBe(expandedWidth);
  });
  it('keeps an inline launcher hidden even though the floating launcher has a display style', () => {
    const { host, button } = create({ mode: 'inline' });
    expect(button.hidden).toBe(true);
    expect(button.style.display).toBe('none');
    expect(host.style.position).toBe('');
  });
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
