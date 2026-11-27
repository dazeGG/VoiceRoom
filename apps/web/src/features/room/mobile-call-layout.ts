import { onScopeDispose, readonly, ref } from 'vue';
import { PORTRAIT_PHONE_QUERY } from '@voiceroom/call/engine/core/mobile-call-ui.store';

export * from '@voiceroom/call/engine/core/mobile-call-layout';

export function usePortraitCallLayout() {
  const media = typeof window.matchMedia === 'function' ? window.matchMedia(PORTRAIT_PHONE_QUERY) : undefined;
  const portrait = ref(media?.matches ?? false);
  function update(event: MediaQueryListEvent): void {
    portrait.value = event.matches;
  }
  media?.addEventListener('change', update);
  onScopeDispose(() => media?.removeEventListener('change', update));
  return readonly(portrait);
}
