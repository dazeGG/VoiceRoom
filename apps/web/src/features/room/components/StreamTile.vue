<script setup lang="ts">
import { Monitor } from '@lucide/vue';
import { computed, ref, watch } from 'vue';
import { createLogger, errorContext } from '@/shared/log';
import { getAvatarPresentation } from '@/shared/ui/avatar-presentation';
import { iconLg } from '@/shared/ui/icons';
import { state as roomState } from '../client/core/room-runtime.store';
import type { Participant } from '../client/core/types';
import { getScreenProfileLabels } from '../client/media/profiles';
import { playMediaElement } from '../client/services/media-playback-service';
import { enterScreenView } from '../client/ui/screen-view';

const log = createLogger('room:stream');

const props = defineProps<{
  participant: Participant;
  hasPreview: boolean;
  isCollapsed: boolean;
  isSubscribed: boolean;
  stream: MediaStream | null;
}>();

const videoEl = ref<HTMLVideoElement | null>(null);
// A new avatar gets a fresh attempt: only the URL that failed stays hidden.
const failedAvatarUrl = ref<string | null>(null);

const isIdle = computed(() => !props.hasPreview);
const isActive = computed(() => props.hasPreview || props.isSubscribed);
const profileMeta = computed(() => {
  const profileId = props.participant.isLocal ? roomState.localScreenProfileId : props.participant.screenProfileId;
  const { qualityLabel, fpsLabel } = getScreenProfileLabels(profileId);
  return [qualityLabel, fpsLabel].filter(Boolean).join(' · ');
});
const streamerAvatar = computed(() => getAvatarPresentation(props.participant));
const avatarImageFailed = computed(
  () => failedAvatarUrl.value !== null && failedAvatarUrl.value === streamerAvatar.value.src
);
const ariaLabel = computed(() =>
  props.hasPreview
    ? `Развернуть стрим ${props.participant.name}`
    : props.isSubscribed
      ? `Подключение к стриму ${props.participant.name}`
      : `Смотреть стрим ${props.participant.name}`
);

function handleEnter(event?: Event): void {
  event?.stopPropagation();
  void enterScreenView(props.participant.id).catch((error: unknown) =>
    log.error('screen view action failed', errorContext(error))
  );
}

watch(
  [videoEl, () => props.stream],
  ([video, stream]) => {
    if (!video || !stream) return;
    if (video.srcObject !== stream) {
      video.srcObject = stream;
      playMediaElement(video);
    }
  },
  { flush: 'post' }
);
</script>

<template>
  <component
    :is="isCollapsed ? 'div' : 'button'"
    :class="[
      'stream-tile',
      {
        'stream-tile--preview': hasPreview,
        'stream-tile--collapsed': isCollapsed,
        'stream-tile--idle': isIdle,
        'stream-tile--local': participant.isLocal
      }
    ]"
    :data-peer-id="participant.id"
    :role="isCollapsed ? 'group' : undefined"
    :type="isCollapsed ? undefined : 'button'"
    :aria-pressed="isCollapsed ? undefined : isActive"
    :aria-label="isCollapsed ? undefined : ariaLabel"
    @click="isCollapsed ? undefined : handleEnter($event)"
  >
    <span class="stream-tile__preview">
      <template v-if="hasPreview && stream">
        <video ref="videoEl" class="stream-tile__video" autoplay muted playsinline></video>
        <span v-if="profileMeta" class="stream-tile__profile-meta">{{ profileMeta }}</span>
      </template>
      <span v-else class="stream-tile__icon" aria-hidden="true"><Monitor v-bind="iconLg" /></span>
    </span>
    <button
      v-if="isCollapsed"
      class="stream-tile__expand"
      type="button"
      :aria-pressed="isActive"
      :aria-label="`Развернуть стрим ${participant.isLocal ? 'ваш' : participant.name}`"
      @click="handleEnter"
    ></button>
    <span v-if="isCollapsed || isIdle" :class="['stream-tile__copy', { 'stream-tile__copy--idle': !isCollapsed }]">
      <span class="stream-tile__plate">
        <span
          class="stream-tile__mini-avatar"
          :style="{ '--avatar-bg': streamerAvatar.background, '--avatar-fg': streamerAvatar.foreground }"
          aria-hidden="true"
          ><img
            v-if="streamerAvatar.src && !avatarImageFailed"
            :src="streamerAvatar.src"
            alt=""
            @error="failedAvatarUrl = streamerAvatar.src"
          /><template v-else>{{ streamerAvatar.initials }}</template></span
        >Стрим
      </span>
    </span>
    <span v-if="!isCollapsed && isIdle" class="stream-tile__actions">
      <span class="stream-tile__action stream-tile__action--primary">
        {{ isSubscribed ? 'Подключение' : 'Смотреть стрим' }}
      </span>
    </span>
  </component>
</template>
