import { t } from '../../i18n';
import type { WidgetLauncherOptions } from './types';

/** The embed launcher lives in the host document, outside the Vue frame and its stylesheet. */
export function createWidgetLauncher({ floating, background, text, accent }: WidgetLauncherOptions) {
  const element = document.createElement('button');
  element.type = 'button';
  element.hidden = !floating;
  element.style.cssText = [
    '--vr-bg:' + background,
    '--vr-text:' + text,
    '--vr-accent:' + accent,
    'display:' + (floating ? 'inline-flex' : 'none'),
    'box-sizing:border-box;align-items:center;justify-content:center;max-width:100%',
    'min-height:var(--size-48,48px);padding:0 var(--space-16,16px)',
    'border:1px solid color-mix(in srgb,var(--vr-text) 12%,transparent);border-radius:var(--radius-pill,999px)',
    'background:var(--vr-bg);color:var(--vr-text);font:600 13px/1.2 Onest,system-ui,sans-serif',
    'overflow-wrap:anywhere;cursor:pointer;touch-action:manipulation;pointer-events:auto',
    'outline-color:var(--vr-accent);outline-offset:var(--space-2,2px)'
  ].join(';');

  function setExpanded(expanded: boolean): void {
    element.setAttribute('aria-expanded', String(expanded));
  }

  function setInCall(active: boolean): void {
    element.textContent = active ? 'VoiceRoom • ' + t('В звонке') : 'VoiceRoom';
  }

  setExpanded(true);
  setInCall(false);
  return { element, setExpanded, setInCall };
}
