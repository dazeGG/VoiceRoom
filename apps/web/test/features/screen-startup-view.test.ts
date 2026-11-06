import { defineComponent, markRaw, nextTick, reactive, ref } from 'vue';
import { render } from '@testing-library/vue';
import { expect, test, vi } from 'vitest';

async function setup() {
  vi.resetModules();
  const stop = vi.fn();
  const start = vi.fn(() => stop);
  const stats = new Map<string, unknown>();
  const publication = {
    source: 'screen_share',
    trackSid: 'TR_remote',
    track: { getRTCStatsReport: vi.fn(async () => stats) }
  };
  // Like the SDK: the map changes in place without Vue observing it.
  const publications = markRaw(new Map([['screen', publication]]));
  const peer = reactive({
    isLocal: false,
    screenProfileId: 'balanced-30',
    livekitParticipant: { trackPublications: publications }
  });
  const store = reactive({ stageVisible: false, revision: 0 });
  let visibility: (visible: boolean) => void = () => {};
  const removeVisibility = vi.fn();
  vi.doMock('@/platform/app-visibility', () => ({
    isAppVisible: () => true,
    onAppVisibilityChange: (listener: (visible: boolean) => void) => {
      visibility = listener;
      return removeVisibility;
    }
  }));
  vi.doMock('@/features/room/screen-ui.store', () => ({
    useScreenUiStore: () => ({
      get stageVisible() {
        return store.stageVisible;
      },
      get revision() {
        return store.revision;
      },
      getActiveScreenPeer: () => peer
    })
  }));
  vi.doMock('@/features/room/client/media/screen-startup-diagnostics', () => ({
    startScreenStartupDiagnostics: start
  }));
  const { useScreenStartupDiagnostics } = await import('@/features/room/use-screen-startup-diagnostics');
  const video = document.createElement('video');
  const mounted = render(
    defineComponent({
      setup() {
        useScreenStartupDiagnostics(ref(video));
        return () => null;
      }
    })
  );
  return {
    start,
    stop,
    store,
    peer,
    publication,
    publications,
    stats,
    video,
    mounted,
    removeVisibility,
    visibility: (visible: boolean) => visibility(visible)
  };
}

test('only an opened remote stage is sampled; UI refreshes do not restart the window', async () => {
  const h = await setup();
  expect(h.start).not.toHaveBeenCalled();
  h.store.stageVisible = true;
  await nextTick();
  expect(h.start).toHaveBeenCalledWith(
    expect.objectContaining({ direction: 'receive', trackId: 'TR_remote', profileId: 'balanced-30' })
  );
  h.store.revision += 1;
  await nextTick();
  expect(h.start).toHaveBeenCalledTimes(1);
  h.store.stageVisible = false;
  await nextTick();
  expect(h.stop).toHaveBeenCalledTimes(1);
  h.store.stageVisible = true;
  await nextTick();
  expect(h.start).toHaveBeenCalledTimes(2);
});

test('hiding and reopening the app observes dynacast resume and unmount removes listeners', async () => {
  const h = await setup();
  h.store.stageVisible = true;
  await nextTick();
  h.visibility(false);
  await nextTick();
  expect(h.stop).toHaveBeenCalledTimes(1);
  h.visibility(true);
  await nextTick();
  expect(h.start).toHaveBeenCalledTimes(2);
  h.mounted.unmount();
  expect(h.stop).toHaveBeenCalledTimes(2);
  expect(h.removeVisibility).toHaveBeenCalledTimes(1);
});

test('a new publication starts a fresh observation, but the local preview does not', async () => {
  const h = await setup();
  h.store.stageVisible = true;
  await nextTick();
  h.publications.set('screen', { ...h.publication, trackSid: 'TR_replacement' });
  h.store.revision += 1;
  await nextTick();
  expect(h.stop).toHaveBeenCalledTimes(1);
  expect(h.start).toHaveBeenLastCalledWith(expect.objectContaining({ trackId: 'TR_replacement' }));
  h.peer.isLocal = true;
  await nextTick();
  expect(h.stop).toHaveBeenCalledTimes(2);
  expect(h.start).toHaveBeenCalledTimes(2);
});
