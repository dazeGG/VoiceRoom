<script setup lang="ts">
import { HeadphoneOff, MicOff } from '@lucide/vue';
import { ref } from 'vue';
import { t } from '../../i18n';
import { iconSm } from '../../icon-defaults';

defineProps<{
  name: string;
  initials: string;
  avatarSrc?: string | null | undefined;
  local?: boolean | undefined;
  statusLabel?: string | undefined;
}>();

defineSlots<{
  name?(): unknown;
  badge?(): unknown;
  default?(): unknown;
}>();

// A changed URL gets its own load attempt.
const failedAvatarUrl = ref<string>();
</script>

<template>
  <div class="participant__ring" aria-hidden="true">
    <span class="participant__avatar">
      <img
        v-if="avatarSrc && failedAvatarUrl !== avatarSrc"
        :src="avatarSrc"
        alt=""
        @error="failedAvatarUrl = avatarSrc"
      />
      <template v-else>{{ initials }}</template>
    </span>
  </div>
  <div class="participant__copy">
    <h2 class="participant__heading">
      <span class="participant__name"
        ><slot name="name">{{ name }}</slot></span
      >
      <slot name="badge" />
      <span v-if="local" class="participant__you">{{ t('вы') }}</span>
      <span class="participant__muted-icon" :aria-label="t('Микрофон выключен')" :title="t('Микрофон выключен')">
        <MicOff v-bind="iconSm" />
      </span>
      <span class="participant__deafened-icon" :aria-label="t('Звук выключен')" :title="t('Звук выключен')">
        <HeadphoneOff v-bind="iconSm" />
      </span>
    </h2>
    <p v-if="statusLabel" class="participant__status">{{ statusLabel }}</p>
    <p v-else class="participant__status" hidden></p>
    <slot />
  </div>
</template>
