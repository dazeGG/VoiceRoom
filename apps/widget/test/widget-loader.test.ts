import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  defaultWidgetConfig,
  encodeWidgetConfig,
  parseWidgetBootstrap,
  widgetEmbedMarkup as widgetSnippet,
  type WidgetConfig
} from '@voiceroom/shared/contracts/widget';
import { mountWidget } from '../src/loader';
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

function send(
  frame: HTMLIFrameElement,
  type: string,
  fields: { nonce?: string; active?: boolean } = {},
  origin = 'https://voice.test'
) {
  const { nonce } = parseWidgetBootstrap(new URL(frame.src).hash);
  window.dispatchEvent(
    new MessageEvent('message', {
      origin,
      source: frame.contentWindow,
      data: { version: 1, nonce, type, ...fields }
    })
  );
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
    expect(button.style.minHeight).toMatch(/^var\(--size-48,\s*48px\)$/);
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
  it('keeps an inline launcher hidden and fills the host width for new embeds', () => {
    const { host, button } = create({ mode: 'inline' });
    expect(button.hidden).toBe(true);
    expect(button.style.display).toBe('none');
    expect(host.style.position).toBe('');
    expect(host.querySelector('iframe')?.style.width).toBe('100%');
  });
  it('declares clipboard permissions and leaves camera delegation off for an audio-only widget', () => {
    const { frame } = create({ camera: false });
    expect(frame.allow).toBe("microphone; camera 'none'; autoplay; clipboard-write");
    const legacy = create();
    expect(legacy.frame.allow).toContain('camera');
  });
  it('retains explicit inline sizes for old embeds', () => {
    const { frame } = create({ mode: 'inline', width: 420, height: 640 });
    expect(frame.style.width).toBe('min(420px, 100%)');
    expect(frame.style.height).toContain('640px');
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
  it('advertises expansion after initialization and restores the same embedded context', () => {
    const { host, frame } = create({ mode: 'inline', width: 420, height: 640 });
    const context = frame.contentWindow;
    if (!context) throw new Error('Missing frame context');
    const post = vi.spyOn(context, 'postMessage');
    const original = frame.style.cssText;
    send(frame, 'ready');
    expect(post).toHaveBeenCalledTimes(2);
    expect(post).toHaveBeenNthCalledWith(1, expect.objectContaining({ type: 'initialize' }), 'https://voice.test');
    expect(post).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ type: 'expandState', active: false }),
      'https://voice.test'
    );
    send(frame, 'requestExpand', {}, 'https://foreign.test');
    send(frame, 'requestExpand', { nonce: 'ab'.repeat(24) });
    expect(frame.style.cssText).toBe(original);

    send(frame, 'requestExpand');
    expect(post).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: 'expandState', active: true }),
      'https://voice.test'
    );
    expect(frame.style.position).toBe('fixed');
    expect(frame.classList.contains('voiceroom-frame--expanded')).toBe(true);
    expect(host.querySelector('iframe')).toBe(frame);
    expect(frame.contentWindow).toBe(context);
    expect(host.children).toHaveLength(3);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
    expect(post).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: 'expandState', active: false }),
      'https://voice.test'
    );
    expect(frame.style.cssText).toBe(original);
    expect(frame.classList.contains('voiceroom-frame--expanded')).toBe(false);
    expect(host.children).toHaveLength(2);
    expect(frame.contentWindow).toBe(context);
  });
  it('closes the previously expanded widget and clears expansion when the call or panel closes', () => {
    const a = create();
    const b = create();
    send(a.frame, 'requestExpand', { active: true });
    expect(a.frame.style.position).toBe('fixed');
    send(b.frame, 'requestExpand');
    expect(a.frame.style.position).not.toBe('fixed');
    expect(b.frame.style.position).toBe('fixed');
    send(b.frame, 'callState', { active: false });
    expect(b.frame.style.position).not.toBe('fixed');
    send(a.frame, 'requestExpand');
    a.button.click();
    expect(a.frame.style.position).toBe('absolute');
    expect(a.frame.inert).toBe(true);
    send(a.frame, 'requestExpand');
    expect(a.frame.style.position).toBe('absolute');
  });
  it('mounts readable snippets and safely round-trips custom titles', () => {
    const config = { ...defaultWidgetConfig, title: `100%: ДнД's "стол" & <друзья>` };
    const snippet = widgetSnippet(config, 'https://voice.test');
    expect(snippet).toContain(`data-config='{\n  "version": 1,`);
    expect(snippet).toContain('type="module"');
    const parsed = new DOMParser().parseFromString(snippet, 'text/html');
    const host = parsed.querySelector<HTMLElement>('[data-voiceroom-widget]');
    if (!host) throw new Error('Missing embed host');
    document.body.append(host);
    disposals.push(mountWidget(host, 'https://voice.test'));
    const frame = host.querySelector('iframe');
    if (!frame) throw new Error('Missing iframe');
    expect(parseWidgetBootstrap(new URL(frame.src).hash).config).toEqual(config);
  });
  it('disposal removes the frame and invalid origins cannot be used in a snippet', () => {
    const a = create();
    const dispose = disposals.pop();
    if (!dispose) throw new Error('Missing disposal');
    dispose();
    expect(a.host.children).toHaveLength(0);
    expect(() => widgetSnippet(defaultWidgetConfig, 'null')).toThrow();
  });
});
