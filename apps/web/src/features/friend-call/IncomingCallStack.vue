<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, useTemplateRef, watch } from 'vue';
import { IncomingCallCard, useDialogOverlayTarget } from '@voiceroom/ui-kit/components';
import { useVoiceSessionStore, clientRoomName } from '@voiceroom/call/engine';
import { t } from '@/shared/i18n';
import { useNotificationPreferencesStore } from '@/shared/notifications/preferences.store';
import { usePortraitCallLayout } from '@/features/room/mobile-call-layout';
import { ringOnThisDevice } from './call-ringer';
import { incomingAttemptKey, useFriendCallStore } from './friend-call.store';

const calls = useFriendCallStore();
const portrait = usePortraitCallLayout();
const voice = useVoiceSessionStore();
const preferences = useNotificationPreferencesStore();
const dialogTarget = useDialogOverlayTarget();
const stack = useTemplateRef<HTMLElement>('stack');
const alert = useTemplateRef<HTMLElement>('alert');
const announced = new Set<string>();
const roomName = computed(() => {
  const id = voice.roomId;
  return id && id !== calls.voice?.roomId ? clientRoomName(id) || id : undefined;
});
const audible = computed(() => {
  const attempt = calls.incoming.find(({ callId }) => calls.busy?.id !== callId);
  return Boolean(
    attempt &&
    calls.mutedAttempt !== incomingAttemptKey(attempt) &&
    !preferences.notificationPreferences.doNotDisturb &&
    !preferences.isPeerNotificationsMuted(attempt.fromUser.id)
  );
});
let returnFocus: HTMLElement | undefined;

watch(
  audible,
  (rings, _, onCleanup) => {
    if (!rings) return;
    const controller = new AbortController();
    onCleanup(() => controller.abort());
    void ringOnThisDevice(controller.signal);
  },
  { immediate: true }
);

watch(
  () => calls.incoming,
  async (attempts) => {
    const focused = document.activeElement;
    const wasInStack = focused instanceof HTMLElement && stack.value?.contains(focused);
    await nextTick();
    if (wasInStack && document.activeElement === document.body) {
      const next = stack.value?.querySelector<HTMLElement>('button:not(:disabled)');
      (next ?? returnFocus)?.focus({ preventScroll: true });
    }
    const region = alert.value;
    if (!region) return;
    const messages = attempts.flatMap((attempt) => {
      const key = incomingAttemptKey(attempt);
      if (announced.has(key) || !calls.incoming.some((current) => incomingAttemptKey(current) === key)) return [];
      announced.add(key);
      const message = document.createElement('span');
      message.textContent = t('{name} звонит вам', { name: attempt.fromUser.displayName });
      return [message];
    });
    if (messages.length) region.replaceChildren(...messages);
    else if (attempts.length === 0) region.replaceChildren();
  },
  { immediate: true }
);

function rememberFocus(event: FocusEvent): void {
  const previous = event.relatedTarget;
  if (previous instanceof HTMLElement && !stack.value?.contains(previous)) returnFocus = previous;
}

onBeforeUnmount(() => {
  if (stack.value?.contains(document.activeElement)) {
    void nextTick(() => {
      if (document.activeElement === document.body && returnFocus?.isConnected) returnFocus.focus();
    });
  }
});
</script>

<template>
  <Teleport :to="dialogTarget ?? 'body'">
    <div ref="alert" class="incoming-call-stack__announcement" aria-live="assertive" aria-atomic="false"></div>
    <div
      v-if="calls.incoming.length"
      ref="stack"
      class="incoming-call-stack"
      role="region"
      :aria-label="t('Входящий звонок')"
      @focusin="rememberFocus"
    >
      <TransitionGroup name="incoming-call">
        <IncomingCallCard
          v-for="(attempt, index) in calls.incoming"
          :key="incomingAttemptKey(attempt)"
          :class="{ 'incoming-call-stack__primary': index === 0 }"
          :caller="{
            name: attempt.fromUser.displayName,
            src: attempt.fromUser.avatarUrl,
            colorKey: attempt.fromUser.avatarColorKey
          }"
          :variant="index === 0 ? 'default' : 'compact'"
          :icon-size="portrait ? 44 : 32"
          :silenced="calls.mutedAttempt === incomingAttemptKey(attempt)"
          :expires-at="attempt.expiresAt"
          :state="calls.busy?.action === 'accept' && calls.busy.id === attempt.callId ? 'accepting' : 'ringing'"
          :leave-room-name="roomName"
          @accept="void calls.act(attempt, 'accept')"
          @decline="void calls.act(attempt, 'decline')"
          @toggle-silence="calls.toggleSilence(attempt)"
        />
      </TransitionGroup>
    </div>
  </Teleport>
</template>
