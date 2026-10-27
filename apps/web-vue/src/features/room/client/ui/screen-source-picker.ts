import { state } from '../core/room-runtime.store';
import type { DesktopCaptureSource, ScreenSourceSelection } from '../core/types';
import { createAbortError } from '../core/utils';
import { createScreenProfileId } from '../media/profiles';
import { useScreenSourceUiStore } from '../../screen-source-ui.store';

export function showScreenSourcePicker(sources: DesktopCaptureSource[]): Promise<ScreenSourceSelection> {
  if (state.screenSourceRequest) cancelScreenSourcePicker();

  return new Promise((resolve, reject) => {
    state.screenSourceRequest = { reject, resolve };
    useScreenSourceUiStore().sources = sources;

    const hasScreens = sources.some((s) => s.type === 'screen');
    const tab: 'screens' | 'windows' = hasScreens ? 'screens' : 'windows';
    useScreenSourceUiStore().tab = tab;
    useScreenSourceUiStore().selectedSourceId = getTabSources(sources, tab)[0]?.id ?? null;

    const currentMode = state.localScreenMode;
    useScreenSourceUiStore().mode = currentMode === 'text' ? 'text' : 'games';
    useScreenSourceUiStore().quality = state.localScreenQualityId === 'high' ? 'high' : 'balanced';
    useScreenSourceUiStore().fps = state.localScreenFpsId === '60' ? '60' : '30';
    useScreenSourceUiStore().audio = true;
    useScreenSourceUiStore().popOpen = false;

    useScreenSourceUiStore().open = true;
  });
}

export function confirmScreenSourcePicker(): void {
  const source = useScreenSourceUiStore().sources.find((s) => s.id === useScreenSourceUiStore().selectedSourceId);
  if (!source) return;

  const fpsId = useScreenSourceUiStore().mode === 'text' ? '5' : useScreenSourceUiStore().fps;
  const qualityId = useScreenSourceUiStore().mode === 'text' ? 'source' : useScreenSourceUiStore().quality;
  const profileId = createScreenProfileId(qualityId, fpsId);

  resolveScreenSourcePicker({
    fpsId,
    mode: useScreenSourceUiStore().mode,
    profileId,
    qualityId,
    source,
    streamAudioEnabled: useScreenSourceUiStore().audio
  });
}

export function switchScreenTab(tab: 'screens' | 'windows'): void {
  useScreenSourceUiStore().tab = tab;
  useScreenSourceUiStore().selectedSourceId = getTabSources(useScreenSourceUiStore().sources, tab)[0]?.id ?? null;
  useScreenSourceUiStore().popOpen = false;
}

function resolveScreenSourcePicker(selection: ScreenSourceSelection): void {
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
  useScreenSourceUiStore().open = false;
  useScreenSourceUiStore().sources = [];
  useScreenSourceUiStore().selectedSourceId = null;
  useScreenSourceUiStore().popOpen = false;
  return request;
}

export function closeScreenSourceOnBackdrop(event: MouseEvent | PointerEvent): void {
  if (event.target instanceof Element && event.target.id === 'screenSourceDialog') cancelScreenSourcePicker();
}

export function closeScreenSourceOnEscape(event: KeyboardEvent): void {
  if (event.key !== 'Escape' || !state.screenSourceRequest) return;
  event.preventDefault();
  cancelScreenSourcePicker();
}

function getTabSources(sources: DesktopCaptureSource[], tab: 'screens' | 'windows'): DesktopCaptureSource[] {
  return sources.filter((s) => (tab === 'screens' ? s.type === 'screen' : s.type !== 'screen'));
}
