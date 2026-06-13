import { state } from '../core/state';
import type { DesktopCaptureSource } from '../core/types';
import { createAbortError } from '../core/utils';
import { elements } from './dom';

export function showScreenSourcePicker(sources: DesktopCaptureSource[]): Promise<DesktopCaptureSource> {
  if (state.screenSourceRequest) cancelScreenSourcePicker();

  return new Promise((resolve, reject) => {
    state.screenSourceRequest = { reject, resolve };
    elements.screenSourceOptions.textContent = '';

    for (const source of sources) {
      const button = createScreenSourceButton(source);
      elements.screenSourceOptions.append(button);
    }

    elements.screenSourceDialog.hidden = false;
    window.setTimeout(() => {
      elements.screenSourceOptions.querySelector('button')?.focus();
    }, 0);
  });
}

function createScreenSourceButton(source: DesktopCaptureSource): HTMLButtonElement {
  const button = document.createElement('button');
  button.className = 'screen-source-option';
  button.type = 'button';
  button.setAttribute('aria-label', source.name);

  const preview = document.createElement('span');
  preview.className = 'screen-source-preview';
  if (source.thumbnail) {
    const image = document.createElement('img');
    image.alt = '';
    image.src = source.thumbnail;
    preview.append(image);
  } else {
    const fallback = document.createElement('span');
    fallback.className = 'screen-source-fallback';
    fallback.textContent = source.type === 'screen' ? 'Экран' : 'Окно';
    preview.append(fallback);
  }

  const label = document.createElement('span');
  label.className = 'screen-source-label';
  if (source.appIcon) {
    const icon = document.createElement('img');
    icon.alt = '';
    icon.src = source.appIcon;
    label.append(icon);
  }
  const name = document.createElement('span');
  name.textContent = source.name;
  label.append(name);

  button.append(preview, label);
  button.addEventListener('click', () => resolveScreenSourcePicker(source));
  return button;
}

function resolveScreenSourcePicker(source: DesktopCaptureSource): void {
  const request = closeScreenSourcePicker();
  request?.resolve(source);
}

export function cancelScreenSourcePicker(): void {
  const request = closeScreenSourcePicker();
  request?.reject(createAbortError('Выбор источника отменен'));
}

function closeScreenSourcePicker() {
  const request = state.screenSourceRequest;
  state.screenSourceRequest = null;
  elements.screenSourceDialog.hidden = true;
  elements.screenSourceOptions.textContent = '';
  return request;
}

export function closeScreenSourceOnBackdrop(event: MouseEvent): void {
  if (event.target === elements.screenSourceDialog) cancelScreenSourcePicker();
}

export function closeScreenSourceOnEscape(event: KeyboardEvent): void {
  if (event.key !== 'Escape' || !state.screenSourceRequest) return;
  event.preventDefault();
  cancelScreenSourcePicker();
}
