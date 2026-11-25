<script setup lang="ts">
import { HeadphoneOff, MicOff, WifiOff } from '@lucide/vue';
import { computed } from 'vue';
import { t } from '../../i18n';
import Avatar from '../Avatar/Avatar.vue';
import Spinner from '../Spinner/Spinner.vue';
import type { ParticipantTileFaceProps } from './types';

const props = withDefaults(defineProps<ParticipantTileFaceProps>(), { state: 'connected' });
const status = computed(() => {
  if (props.state === 'reconnecting') return t('Подключаемся…');
  if (props.state === 'absent') return t('Не в звонке');
  return props.statusLabel;
});

defineSlots<{
  name?(): unknown;
  badge?(): unknown;
  default?(): unknown;
}>();
</script>

<template>
  <div
    class="participant__ring"
    :class="{
      'ui-participant-tile-face__ring--placeholder': state !== 'connected',
      'ui-participant-tile-face__ring--absent': state === 'absent'
    }"
    aria-hidden="true"
  >
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
      <slot v-if="state === 'connected'" name="badge" />
      <span v-if="local" class="participant__you">{{ t('вы') }}</span>
      <template v-if="state === 'connected'">
        <span class="participant__muted-icon" :aria-label="t('Микрофон выключен')" :title="t('Микрофон выключен')">
          <MicOff aria-hidden="true" />
        </span>
        <span class="participant__deafened-icon" :aria-label="t('Звук выключен')" :title="t('Звук выключен')">
          <HeadphoneOff aria-hidden="true" />
        </span>
      </template>
      <WifiOff v-else-if="state === 'reconnecting'" class="ui-participant-tile-face__offline" aria-hidden="true" />
    </h2>
    <p
      class="participant__status"
      :class="{ 'ui-participant-tile-face__status': state !== 'connected' }"
      :role="state !== 'connected' ? 'status' : undefined"
      :hidden="!status"
    >
      <Spinner v-if="state === 'reconnecting'" :size="12" aria-hidden="true" />{{ status }}
    </p>
    <slot v-if="state === 'connected'" />
  </div>
</template>
