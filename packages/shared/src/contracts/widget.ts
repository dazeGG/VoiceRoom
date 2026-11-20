import { RoomCapabilities, RoomProof } from './rooms.ts';
import { Type, type Static } from 'typebox';
import { Value } from 'typebox/value';

const color = Type.String({ pattern: '^#[0-9a-fA-F]{6}$' });
export const DEFAULT_WIDGET_TITLE = 'Голосовой чат';
export const WIDGET_TITLE_LIMIT = 80;
export const WIDGET_SERVICE_ORIGIN = 'https://voiceroom.ru';
export const WIDGET_SERVICE_URL = `${WIDGET_SERVICE_ORIGIN}/`;
export const DEFAULT_WIDGET_WIDTH = 360;
export const DEFAULT_WIDGET_HEIGHT = 520;
export const DEFAULT_WIDGET_PREVIEW_HEIGHT = 400;
export const WIDGET_SIZE_LIMITS = {
  width: { minimum: 280, maximum: 960 },
  height: { minimum: 320, maximum: 900 }
} as const;

export const WidgetConfig = Type.Object(
  {
    version: Type.Literal(1),
    title: Type.Optional(Type.String({ minLength: 1, maxLength: WIDGET_TITLE_LIMIT })),
    mode: Type.Union([Type.Literal('inline'), Type.Literal('floating')]),
    background: color,
    text: color,
    accent: color,
    radius: Type.Integer({ minimum: 0, maximum: 24 }),
    // Floating panels set a size. Earlier inline embeds may also specify one.
    width: Type.Optional(Type.Integer(WIDGET_SIZE_LIMITS.width)),
    height: Type.Optional(Type.Integer(WIDGET_SIZE_LIMITS.height)),
    corner: Type.Union([
      Type.Literal('top-left'),
      Type.Literal('top-right'),
      Type.Literal('bottom-left'),
      Type.Literal('bottom-right')
    ]),
    offset: Type.Integer({ minimum: 0, maximum: 48 }),
    // Retained for previously copied snippets.
    chat: Type.Optional(Type.Boolean()),
    camera: Type.Optional(Type.Boolean())
  },
  { additionalProperties: false }
);
export type WidgetConfig = Static<typeof WidgetConfig>;
export const defaultWidgetConfig: Readonly<WidgetConfig> = Object.freeze({
  version: 1,
  mode: 'inline',
  background: '#171923',
  text: '#ffffff',
  accent: '#a5b4fc',
  radius: 16,
  corner: 'bottom-right',
  offset: 16
});
export function parseWidgetConfig(value: unknown): WidgetConfig {
  if (!Value.Check(WidgetConfig, value) || new TextEncoder().encode(JSON.stringify(value)).length > 2048) {
    throw new Error('Invalid widget configuration');
  }
  return { ...value };
}
export function decodeWidgetConfig(serialized: string): WidgetConfig {
  if (new TextEncoder().encode(serialized).length > 2048) throw new Error('Widget configuration too large');
  return parseWidgetConfig(JSON.parse(serialized));
}
export function encodeWidgetConfig(value: WidgetConfig): string {
  return JSON.stringify(parseWidgetConfig(value));
}

export function decodeWidgetEmbedConfig(attribute: string): WidgetConfig {
  return decodeWidgetConfig(attribute.trimStart().startsWith('{') ? attribute : decodeURIComponent(attribute));
}

export function widgetEmbedMarkup(config: WidgetConfig, origin = WIDGET_SERVICE_ORIGIN): string {
  const base = widgetOrigin(origin);
  // A single-quoted HTML attribute keeps the JSON quotes readable.
  const value = JSON.stringify(parseWidgetConfig(config), null, 2)
    .replaceAll('&', '&amp;')
    .replaceAll("'", '&#39;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
  return `<div data-voiceroom-widget data-config='${value}'></div>\n<script type="module" src="${base}/widget/v1/loader.js" defer></script>`;
}

export function normalizeWidgetColor(input: string): string | null {
  const value = input.trim().toLowerCase();
  const hex = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/.exec(value)?.[1];
  if (hex) return `#${hex.length === 3 ? hex.replace(/./g, '$&$&') : hex}`;

  const rgb =
    /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/.exec(value) ??
    /^rgb\(\s*(\d{1,3})\s+(\d{1,3})\s+(\d{1,3})\s*\)$/.exec(value);
  if (!rgb) return null;
  const channels = rgb.slice(1).map(Number);
  if (channels.some((channel) => channel > 255)) return null;
  return `#${channels.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
}
/** Canonical tuple origins only; URL parsing is the Firefox-compatible fallback. */
export function widgetOrigin(value: string): string {
  const url = new URL(value);
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (
    url.origin === 'null' ||
    value !== url.origin ||
    (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback))
  ) {
    throw new Error('Invalid widget origin');
  }
  return url.origin;
}
export interface WidgetBootstrap {
  config: WidgetConfig;
  parentOrigin: string;
  nonce: string;
}
export function parseWidgetBootstrap(fragment: string): WidgetBootstrap {
  if (fragment.length > 8192) throw new Error('Invalid widget bootstrap');
  const fields = new URLSearchParams(fragment.replace(/^#/, ''));
  const keys: string[] = [];
  fields.forEach((_value, key) => keys.push(key));
  if (keys.some((key) => !['config', 'parentOrigin', 'nonce'].includes(key)) || keys.length !== 3)
    throw new Error('Invalid widget bootstrap');
  const nonce = fields.get('nonce') ?? '';
  if (!/^[a-f0-9]{32,128}$/.test(nonce)) throw new Error('Invalid widget nonce');
  return {
    config: decodeWidgetConfig(fields.get('config') ?? ''),
    parentOrigin: widgetOrigin(fields.get('parentOrigin') ?? ''),
    nonce
  };
}
export const WidgetMessage = Type.Object(
  {
    version: Type.Literal(1),
    nonce: Type.String({ pattern: '^[a-f0-9]{32,128}$' }),
    type: Type.Union([
      Type.Literal('ready'),
      Type.Literal('initialize'),
      Type.Literal('requestCollapse'),
      Type.Literal('requestExpand'),
      Type.Literal('expandState'),
      Type.Literal('callState')
    ]),
    active: Type.Optional(Type.Boolean())
  },
  { additionalProperties: false }
);
export type WidgetMessage = Static<typeof WidgetMessage>;
export function parseWidgetMessage(value: unknown): WidgetMessage | null {
  return Value.Check(WidgetMessage, value) ? value : null;
}

export const WidgetRoomCreated = Type.Object({
  ok: Type.Literal(true),
  roomId: Type.String(),
  chat: Type.Boolean(),
  maxRoomPeers: Type.Number()
});
export const WidgetRoomInfo = Type.Object({
  ...WidgetRoomCreated.properties,
  capabilities: Type.Optional(RoomCapabilities),
  peers: Type.Number()
});

export const WidgetCreateRoomBody = Type.Object(
  { chat: Type.Boolean(), proof: Type.Optional(RoomProof) },
  { additionalProperties: false }
);
export const WidgetCodeParams = Type.Object({ code: Type.String() });
