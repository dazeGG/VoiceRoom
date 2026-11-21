<script setup lang="ts">
import { HeadphoneOff, MicOff } from '@lucide/vue';
import { t } from '../../i18n';
import Avatar from '../Avatar/Avatar.vue';

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
</script>

<template>
  <div class="participant__ring" aria-hidden="true">
    <Avatar
      class="participant__avatar"
      :name="name"
      :src="avatarSrc"
      background="var(--participant-pastel)"
      foreground="var(--participant-avatar-fg)"
    >
      <template #fallback>{{ initials }}</template>
    </Avatar>
  </div>
  <div class="participant__copy">
    <h2 class="participant__heading">
      <span class="participant__name"
        ><slot name="name">{{ name }}</slot></span
      >
      <slot name="badge" />
      <span v-if="local" class="participant__you">{{ t('вы') }}</span>
      <span class="participant__muted-icon" :aria-label="t('Микрофон выключен')" :title="t('Микрофон выключен')">
        <MicOff aria-hidden="true" />
      </span>
      <span class="participant__deafened-icon" :aria-label="t('Звук выключен')" :title="t('Звук выключен')">
        <HeadphoneOff aria-hidden="true" />
      </span>
    </h2>
    <p v-if="statusLabel" class="participant__status">{{ statusLabel }}</p>
    <p v-else class="participant__status" hidden></p>
    <slot />
  </div>
</template>
