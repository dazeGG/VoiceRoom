import { state } from '../core/state.svelte';
import type { DesktopCaptureSource, ScreenSourceSelection } from '../core/types';
import { createAbortError } from '../core/utils';
import { createScreenProfileId } from '../media/profiles';
import { screenSourceUi } from '../../screen-source-ui.svelte';

export function showScreenSourcePicker(sources: DesktopCaptureSource[]): Promise<ScreenSourceSelection> {
  if (state.screenSourceRequest) cancelScreenSourcePicker();

  return new Promise((resolve, reject) => {
    state.screenSourceRequest = { reject, resolve };
    screenSourceUi.sources = sources;

    const hasScreens = sources.some((s) => s.type === 'screen');
    const tab: 'screens' | 'windows' = hasScreens ? 'screens' : 'windows';
    screenSourceUi.tab = tab;
    screenSourceUi.selectedSourceId = getTabSources(sources, tab)[0]?.id ?? null;

    const currentMode = state.localScreenMode;
    screenSourceUi.mode = currentMode === 'text' ? 'text' : 'games';
    screenSourceUi.quality = state.localScreenQualityId === 'high' ? 'high' : 'balanced';
    screenSourceUi.audio = true;
    screenSourceUi.popOpen = false;

    screenSourceUi.open = true;
  });
}

export function confirmScreenSourcePicker(): void {
  const source = screenSourceUi.sources.find((s) => s.id === screenSourceUi.selectedSourceId);
  if (!source) return;

  const fpsId = screenSourceUi.mode === 'text' ? '5' : '30';
  const qualityId = screenSourceUi.quality;
  const profileId = createScreenProfileId(qualityId, fpsId);

  state.localScreenMode = screenSourceUi.mode;
  state.localScreenQualityId = qualityId;
  state.localScreenFpsId = fpsId;
  state.localScreenProfileId = profileId;
  state.localScreenTargetProfileId = profileId;

  resolveScreenSourcePicker({
    fpsId,
    profileId,
    qualityId,
    source,
    streamAudioEnabled: screenSourceUi.audio
  });
}

export function switchScreenTab(tab: 'screens' | 'windows'): void {
  screenSourceUi.tab = tab;
  screenSourceUi.selectedSourceId = getTabSources(screenSourceUi.sources, tab)[0]?.id ?? null;
  screenSourceUi.popOpen = false;
}

export function resolveScreenSourcePicker(selection: ScreenSourceSelection): void {
  const request = closeScreenSourcePicker();
  request?.resolve(selection);
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
  screenSourceUi.selectedSourceId = null;
  screenSourceUi.popOpen = false;
  return request;
}

export function closeScreenSourceOnBackdrop(event: MouseEvent | PointerEvent): void {
  if ((event.target as HTMLElement).id === 'screenSourceDialog') cancelScreenSourcePicker();
}

export function closeScreenSourceOnEscape(event: KeyboardEvent): void {
  if (event.key !== 'Escape' || !state.screenSourceRequest) return;
  event.preventDefault();
  cancelScreenSourcePicker();
}

function getTabSources(sources: DesktopCaptureSource[], tab: 'screens' | 'windows'): DesktopCaptureSource[] {
  return sources.filter((s) => tab === 'screens' ? s.type === 'screen' : s.type !== 'screen');
}
