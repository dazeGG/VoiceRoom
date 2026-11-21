import {
  DEFAULT_WIDGET_HEIGHT,
  DEFAULT_WIDGET_TITLE,
  DEFAULT_WIDGET_WIDTH,
  normalizeWidgetColor,
  parseWidgetConfig,
  widgetEmbedMarkup
} from '@voiceroom/shared/contracts/widget';
import { createRoomCode } from '@voiceroom/shared/validation';
import { fitWidgetTiles } from '@voiceroom/ui/tile-grid';
import { widgetCodeParts } from './widget-code-syntax.ts';

const settings = document.querySelector<HTMLFormElement>('[data-widget-settings]');
const preview = document.querySelector<HTMLElement>('[data-widget-preview]');
const code = document.querySelector<HTMLElement>('[data-widget-code]');
const copy = document.querySelector<HTMLButtonElement>('[data-copy-code]');
const status = document.querySelector<HTMLElement>('[data-copy-status]');

for (const slider of document.querySelectorAll('[data-size-slider]')) {
  const input = slider.querySelector<HTMLInputElement>('input[type="range"]');
  const output = slider.querySelector<HTMLOutputElement>('output');
  if (!input || !output) continue;
  const sync = () => {
    const min = Number(input.min);
    const max = Number(input.max);
    const position = ((input.valueAsNumber - min) / (max - min)) * 100;
    const unit = input.dataset.sliderUnit;
    const label = unit ? `${input.value} ${unit}` : input.value;
    input.style.setProperty('--widget-slider-position', `${position}%`);
    input.setAttribute('aria-valuetext', label);
    output.value = label;
  };
  input.addEventListener('input', sync);
  sync();
}

if (settings && preview && code && copy && status) {
  const position = settings.querySelector<HTMLElement>('[data-widget-position]');
  const inlineHint = settings.querySelector<HTMLElement>('[data-placement-inline]');
  const floatingHint = settings.querySelector<HTMLElement>('[data-placement-floating]');
  const title = preview.querySelector<HTMLElement>('[data-preview-title]');
  const launcher = preview.querySelector<HTMLElement>('[data-preview-launcher]');
  let copyTimer: ReturnType<typeof setTimeout> | undefined;
  const resetCopy = () => {
    clearTimeout(copyTimer);
    copy.removeAttribute('data-copied');
    copy.title = 'Скопировать код';
    status.classList.remove('visually-hidden');
    status.textContent = '';
  };
  const colorCodes: HTMLInputElement[] = [];
  for (const field of settings.querySelectorAll('[data-widget-color]')) {
    const swatch = field.querySelector<HTMLInputElement>('input[type="color"]');
    const colorCode = field.querySelector<HTMLInputElement>('input[type="text"]');
    if (!swatch || !colorCode) continue;
    colorCodes.push(colorCode);
    swatch.addEventListener('input', () => {
      colorCode.value = swatch.value;
      colorCode.setCustomValidity('');
    });
    colorCode.addEventListener('input', () => {
      const color = normalizeWidgetColor(colorCode.value);
      if (color) swatch.value = color;
      colorCode.setCustomValidity(color ? '' : 'Введите цвет в формате HEX или RGB.');
    });
  }

  const update = () => {
    resetCopy();
    const values = new FormData(settings);
    const number = (name: string) => Number(values.get(name) || NaN);
    const floating = values.get('mode') === 'floating';
    const enteredTitle = values.get('title');
    const heading = (typeof enteredTitle === 'string' && enteredTitle.trim()) || DEFAULT_WIDGET_TITLE;
    const invalidColor = colorCodes.some((input) => !input.validity.valid);
    if (position) position.hidden = !floating;
    if (inlineHint) inlineHint.hidden = floating;
    if (floatingHint) floatingHint.hidden = !floating;
    if (title) title.textContent = heading;
    try {
      const config = parseWidgetConfig({
        version: 1,
        ...(heading === DEFAULT_WIDGET_TITLE ? {} : { title: heading }),
        mode: values.get('mode'),
        background: values.get('background'),
        text: values.get('text'),
        accent: values.get('accent'),
        radius: number('radius'),
        ...(floating ? { width: number('width'), height: number('height') } : {}),
        ...(values.has('camera') ? {} : { camera: false }),
        corner: values.get('corner'),
        offset: number('offset')
      });
      const snippet = invalidColor ? '' : widgetEmbedMarkup(config);
      code.replaceChildren(
        ...widgetCodeParts(snippet).map(({ text, kind }) => {
          if (!kind) return text;
          const span = document.createElement('span');
          span.dataset.syntax = kind;
          span.textContent = text;
          return span;
        })
      );
      status.textContent = invalidColor ? 'Введите цвет в формате HEX или RGB.' : '';
      copy.disabled = invalidColor;
      preview.style.setProperty('--preview-bg', config.background);
      preview.style.setProperty('--preview-text', config.text);
      preview.style.setProperty('--preview-accent', config.accent);
      preview.style.setProperty('--preview-radius', `${config.radius}px`);
      if (floating) preview.style.setProperty('--preview-offset', `${config.offset}px`);
      else preview.style.removeProperty('--preview-offset');
      preview.dataset.previewCorner = floating ? config.corner : '';
      preview.dataset.previewCamera = config.camera === false ? 'off' : 'on';
      if (launcher) launcher.hidden = !floating;
    } catch {
      code.textContent = '';
      status.textContent = 'Введите скругление и отступ в пределах указанных диапазонов.';
      copy.disabled = true;
    }
  };

  settings.addEventListener('submit', (event) => event.preventDefault());
  settings.addEventListener('input', update);
  copy.hidden = false;
  const copySnippet = async () => {
    const snippet = code.textContent;
    if (!snippet) return;
    resetCopy();
    try {
      await navigator.clipboard.writeText(snippet);
      if (code.textContent !== snippet) return;
      copy.setAttribute('data-copied', '');
      copy.title = 'Скопировано';
      status.classList.add('visually-hidden');
      status.textContent = 'Код скопирован.';
      copyTimer = setTimeout(resetCopy, 1800);
    } catch {
      if (code.textContent !== snippet) return;
      const selection = document.getSelection();
      if (selection) {
        const range = document.createRange();
        range.selectNodeContents(code);
        selection.removeAllRanges();
        selection.addRange(range);
      }
      status.textContent = selection ? 'Код выделен. Скопируйте его вручную.' : 'Выделите и скопируйте код вручную.';
    }
  };
  copy.addEventListener('click', () => {
    void copySnippet();
  });
  update();
}

if (preview) {
  const stage = preview.querySelector<HTMLElement>('[data-preview-stage]');
  const demoSizes = preview.querySelector<HTMLElement>('[data-preview-sizes]');
  const demoWidth = preview.querySelector<HTMLInputElement>('[data-preview-width]');
  const demoHeight = preview.querySelector<HTMLInputElement>('[data-preview-height]');
  const floatingMode = settings?.querySelector<HTMLInputElement>('input[name="mode"][value="floating"]');
  const panelWidth = settings?.querySelector<HTMLInputElement>('input[name="width"]');
  const panelHeight = settings?.querySelector<HTMLInputElement>('input[name="height"]');
  const scaleLabel = preview.querySelector<HTMLElement>('[data-preview-scale]');
  const entry = preview.querySelector<HTMLElement>('[data-preview-entry]');
  const call = preview.querySelector<HTMLElement>('[data-preview-call]');
  const count = preview.querySelector<HTMLInputElement>('[data-preview-count]');
  const countField = preview.querySelector<HTMLElement>('[data-preview-count-field]');
  const tiles = preview.querySelector<HTMLElement>('.widget-preview__tiles');
  const peers = [...preview.querySelectorAll<HTMLElement>('[data-preview-peer]')];
  const roomCode = preview.querySelector<HTMLElement>('[data-preview-room-code]');
  if (roomCode) roomCode.textContent = createRoomCode();
  const copyRoomCode = preview.querySelector<HTMLButtonElement>('[data-preview-copy-room-code]');
  const copyFeedback = preview.querySelector<HTMLElement>('[data-preview-copy-feedback]');
  const copyIcon = copyRoomCode?.querySelector<HTMLElement>('.widget-preview__copy-icon');
  const copyCheck = copyRoomCode?.querySelector<HTMLElement>('[data-preview-copy-check]');
  if (call && roomCode && copyRoomCode && copyFeedback) {
    let resetFeedback: ReturnType<typeof setTimeout>;
    const copyCode = async () => {
      let copied = false;
      try {
        await navigator.clipboard.writeText(roomCode.textContent ?? '');
        copied = true;
      } catch {
        const selection = document.getSelection();
        const range = document.createRange();
        range.selectNodeContents(roomCode);
        selection?.removeAllRanges();
        selection?.addRange(range);
      }
      clearTimeout(resetFeedback);
      if (copyIcon) copyIcon.hidden = copied;
      if (copyCheck) copyCheck.hidden = !copied;
      call.setAttribute('data-copy-open', '');
      copyFeedback.textContent = copied ? 'Код скопирован' : 'Скопируйте выделенный код';
      resetFeedback = setTimeout(() => {
        if (copyIcon) copyIcon.hidden = false;
        if (copyCheck) copyCheck.hidden = true;
        call.removeAttribute('data-copy-open');
        copyFeedback.textContent = '';
      }, 1800);
    };
    copyRoomCode.addEventListener('click', () => {
      void copyCode();
    });
  }
  if (stage && demoWidth && demoHeight) {
    const resize = () => {
      const floating = floatingMode?.checked === true;
      const inlineSize = (floating ? panelWidth : demoWidth)?.valueAsNumber ?? DEFAULT_WIDGET_WIDTH;
      const blockSize = floating ? (panelHeight?.valueAsNumber ?? DEFAULT_WIDGET_HEIGHT) : demoHeight.valueAsNumber;
      if (demoSizes) demoSizes.hidden = floating;
      const scale = Math.min(1, stage.clientWidth / inlineSize);
      preview.style.setProperty('--preview-width', `${inlineSize}px`);
      preview.style.setProperty('--preview-height', `${blockSize}px`);
      preview.style.setProperty('--preview-scale', String(scale));
      if (scaleLabel) {
        scaleLabel.hidden = scale === 1;
        scaleLabel.textContent = `Масштаб ${Math.round(scale * 100)}%`;
      }
    };
    demoWidth.addEventListener('input', resize);
    demoHeight.addEventListener('input', resize);
    settings?.addEventListener('input', resize);
    new ResizeObserver(resize).observe(stage);
    resize();
  }
  const deviceButtons = preview.querySelectorAll<HTMLButtonElement>('[data-preview-device]');
  const devicePanels = preview.querySelectorAll<HTMLElement>('[data-preview-device-panel]');
  const cameraGroup = preview.querySelector<HTMLElement>('[data-preview-camera-group]');
  let openDevice: HTMLButtonElement | undefined;
  const showDevice = (button?: HTMLButtonElement, restoreFocus = true) => {
    if (!button && restoreFocus) openDevice?.focus();
    openDevice = button;
    call?.toggleAttribute('data-device-open', Boolean(button));
    const device = button?.dataset.previewDevice;
    for (const trigger of deviceButtons) trigger.setAttribute('aria-expanded', String(trigger === button));
    for (const panel of devicePanels) {
      panel.hidden = panel.dataset.previewDevicePanel !== device;
      if (!panel.hidden) panel.querySelector<HTMLSelectElement>('select')?.focus();
    }
  };
  for (const button of deviceButtons)
    button.addEventListener('click', () => showDevice(openDevice === button ? undefined : button));
  for (const close of preview.querySelectorAll('[data-preview-device-close]'))
    close.addEventListener('click', () => showDevice());
  const syncCamera = () => {
    const enabled = preview.dataset.previewCamera !== 'off';
    if (cameraGroup) cameraGroup.hidden = !enabled;
    if (!enabled && openDevice?.dataset.previewDevice === 'camera') showDevice(undefined, false);
  };
  settings?.addEventListener('input', syncCamera);
  syncCamera();

  const card = preview.querySelector<HTMLElement>('[data-preview-card]');
  const slot = card?.parentElement;
  const expand = preview.querySelector<HTMLButtonElement>('[data-preview-expand]');
  const expandIcon = expand?.querySelector<HTMLElement>('[data-preview-expand-icon]');
  const restoreIcon = expand?.querySelector<HTMLElement>('[data-preview-restore-icon]');
  let expanded = false;
  let motion: Animation | undefined;
  const setExpanded = (next: boolean, animate = true) => {
    if (!card || !slot || !expand) return;
    const from = card.getBoundingClientRect();
    motion?.cancel();
    expanded = next;
    const label = next ? 'Вернуть размер виджета' : 'Развернуть виджет';
    expand.setAttribute('aria-expanded', String(next));
    expand.setAttribute('aria-label', label);
    expand.title = label;
    if (expandIcon) expandIcon.hidden = next;
    if (restoreIcon) restoreIcon.hidden = !next;

    if (next && !card.hasAttribute('data-preview-expanded')) {
      card.setAttribute('data-preview-expanded', '');
      if (typeof card.showPopover === 'function') {
        card.setAttribute('popover', 'manual');
        card.showPopover();
      }
    }
    const restore = () => {
      if (card.hasAttribute('popover')) {
        card.hidePopover();
        card.removeAttribute('popover');
      }
      card.removeAttribute('data-preview-expanded');
    };
    if (!animate || matchMedia('(prefers-reduced-motion: reduce)').matches || typeof card.animate !== 'function') {
      if (!next) restore();
      return;
    }
    const base = card.getBoundingClientRect();
    const to = next ? base : slot.getBoundingClientRect();
    if (!base.width || !base.height) {
      if (!next) restore();
      return;
    }
    const transform = (rect: DOMRect) =>
      `translate(${rect.x - base.x}px, ${rect.y - base.y}px) scale(${rect.width / base.width}, ${rect.height / base.height})`;
    motion = card.animate([{ transform: transform(from) }, { transform: transform(to) }], {
      duration: 220,
      easing: 'cubic-bezier(0.2, 0.7, 0.3, 1)'
    });
    if (!next) motion.onfinish = restore;
  };
  expand?.addEventListener('click', () => setExpanded(!expanded));
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (openDevice) showDevice();
    else if (expanded) setExpanded(false);
  });
  const syncScreen = () => {
    const showCall = preview.querySelector<HTMLInputElement>('input[name="preview-screen"]:checked')?.value === 'call';
    preview.dataset.previewScreen = showCall ? 'call' : 'entry';
    if (!showCall && openDevice) showDevice(undefined, false);
    if (!showCall && card?.hasAttribute('data-preview-expanded')) setExpanded(false, false);
    if (entry) entry.hidden = showCall;
    if (call) call.hidden = !showCall;
    if (countField) countField.hidden = !showCall;
    if (expand) expand.hidden = !showCall;
  };
  const syncCount = () => {
    if (!count || !tiles) return;
    const visible = peers.slice(0, count.valueAsNumber);
    for (const peer of visible) peer.hidden = false;
    tiles.replaceChildren(...visible);
  };
  for (const screen of preview.querySelectorAll('input[name="preview-screen"]'))
    screen.addEventListener('change', syncScreen);
  count?.addEventListener('input', syncCount);
  syncScreen();
  syncCount();
  if (tiles) fitWidgetTiles(tiles);
}
