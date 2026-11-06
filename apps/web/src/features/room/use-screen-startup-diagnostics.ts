import { computed, onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue';
import { isAppVisible, onAppVisibilityChange } from '@/platform/app-visibility';
import { startScreenStartupDiagnostics } from './client/media/screen-startup-diagnostics';
import { isScreenVideoPublication } from './client/services/livekit/publication-kinds';
import { useScreenUiStore } from './screen-ui.store';

/** The displayed stage owns this observer, including close/reopen and visibility pauses. */
export function useScreenStartupDiagnostics(video: Ref<HTMLVideoElement | null>): void {
  const screenUi = useScreenUiStore();
  const visible = ref(isAppVisible());
  let removeVisibility: (() => void) | undefined;
  onMounted(() => {
    removeVisibility = onAppVisibilityChange((value) => {
      visible.value = value;
    });
  });
  onBeforeUnmount(() => removeVisibility?.());

  // Publications are raw SDK objects; a revision announces in-place track changes.
  const screen = computed(() => ({ revision: screenUi.revision, peer: screenUi.getActiveScreenPeer() }));
  const publication = computed(() => {
    const peer = screen.value.peer;
    if (!visible.value || !screenUi.stageVisible || !peer || peer.isLocal) return null;
    return [...(peer.livekitParticipant?.trackPublications.values() ?? [])].find(isScreenVideoPublication) ?? null;
  });

  watch(
    [publication, video],
    ([source, element], _previous, onCleanup) => {
      if (!source || !element) return;
      const stop = startScreenStartupDiagnostics({
        direction: 'receive',
        trackId: source.trackSid,
        profileId: screenUi.getActiveScreenPeer()?.screenProfileId ?? '',
        // Begin before subscription completes: missing reports are not zero FPS.
        read: async () => source.track?.getRTCStatsReport(),
        playback: () => element.getVideoPlaybackQuality?.()
      });
      onCleanup(stop);
    },
    { immediate: true, flush: 'post' }
  );
}
