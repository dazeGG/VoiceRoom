<script setup lang="ts">
import { t } from '@voice-room/ui/i18n';
import { iconLg } from '@voice-room/ui/icon-defaults';
import { Monitor } from '@lucide/vue';
import { computed, ref, watch } from 'vue';
import type { Participant } from '../engine/core/types';
import type { CallAvatar } from './types';

const props = defineProps<{
  participant: Pick<Participant, 'id' | 'name' | 'isLocal'>;
  avatar: CallAvatar;
  profileMeta: string;
  hasPreview: boolean;
  isCollapsed: boolean;
  isSubscribed: boolean;
  stream: MediaStream | null;
}>();

const emit = defineEmits<{
  watchScreen: [];
  previewAttached: [video: HTMLVideoElement];
}>();

const videoEl = ref<HTMLVideoElement | null>(null);
// A new avatar gets a fresh attempt: only the URL that failed stays hidden.
const failedAvatarUrl = ref<string | null>(null);

const isIdle = computed(() => !props.hasPreview);
const isActive = computed(() => props.hasPreview || props.isSubscribed);
const avatarImageFailed = computed(() => failedAvatarUrl.value !== null && failedAvatarUrl.value === props.avatar.src);
const ariaLabel = computed(() =>
  props.hasPreview
    ? t('Развернуть стрим {p0}', { p0: props.participant.name })
    : props.isSubscribed
      ? t('Подключение к стриму {p0}', { p0: props.participant.name })
      : t('Смотреть стрим {p0}', { p0: props.participant.name })
);

function handleEnter(event?: Event): void {
  event?.stopPropagation();
  emit('watchScreen');
}

watch(
  [videoEl, () => props.stream],
  ([video, stream]) => {
    if (!video || !stream) return;
    if (video.srcObject !== stream) {
      video.srcObject = stream;
      emit('previewAttached', video);
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
      :aria-label="t('Развернуть стрим {p0}', { p0: participant.isLocal ? t('ваш') : participant.name })"
      @click="handleEnter"
    ></button>
    <span v-if="isCollapsed || isIdle" :class="['stream-tile__copy', { 'stream-tile__copy--idle': !isCollapsed }]">
      <span class="stream-tile__plate">
        <span
          class="stream-tile__mini-avatar"
          :style="{ '--avatar-bg': avatar.background, '--avatar-fg': avatar.foreground }"
          aria-hidden="true"
          ><img
            v-if="avatar.src && !avatarImageFailed"
            :src="avatar.src"
            alt=""
            @error="failedAvatarUrl = avatar.src"
          /><template v-else>{{ avatar.initials }}</template></span
        >{{ t('Стрим') }}
      </span>
    </span>
    <span v-if="!isCollapsed && isIdle" class="stream-tile__actions">
      <span class="stream-tile__action stream-tile__action--primary">
        {{ isSubscribed ? t('Подключение') : t('Смотреть стрим') }}
      </span>
    </span>
  </component>
</template>
