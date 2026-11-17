import {
  encodeWidgetConfig,
  parseWidgetConfig,
  widgetOrigin,
  type WidgetConfig
} from '@voice-room/shared/contracts/widget';

export function widgetSnippet(config: WidgetConfig, origin: string): string {
  const base = widgetOrigin(origin);
  const value = encodeURIComponent(encodeWidgetConfig(parseWidgetConfig(config)));
  return `<div data-voiceroom-widget data-config="${value}"></div>\n<script type="module" src="${base}/widget/v1/loader.js" defer></script>`;
}
