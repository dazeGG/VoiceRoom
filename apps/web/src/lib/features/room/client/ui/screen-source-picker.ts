import { state } from '../core/state.svelte';
import type { DesktopCaptureSource } from '../core/types';
import { createAbortError } from '../core/utils';
import { screenSourceUi } from '../../screen-source-ui.svelte';

export function showScreenSourcePicker(sources: DesktopCaptureSource[]): Promise<DesktopCaptureSource> {
  if (state.screenSourceRequest) cancelScreenSourcePicker();

  return new Promise((resolve, reject) => {
    state.screenSourceRequest = { reject, resolve };
    screenSourceUi.sources = sources;
    screenSourceUi.open = true;
  });
}

export function resolveScreenSourcePicker(source: DesktopCaptureSource): void {
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
  screenSourceUi.open = false;
  screenSourceUi.sources = [];
  return request;
}

export function closeScreenSourceOnBackdrop(event: MouseEvent): void {
  if ((event.target as HTMLElement).id === 'screenSourceDialog') cancelScreenSourcePicker();
}

export function closeScreenSourceOnEscape(event: KeyboardEvent): void {
  if (event.key !== 'Escape' || !state.screenSourceRequest) return;
  event.preventDefault();
  cancelScreenSourcePicker();
}