<script setup lang="ts">
import { BadgeCheck } from '@lucide/vue';
import { computed } from 'vue';
import { t } from '../../i18n';
import type { AccountBadgeProps } from './types';

const props = withDefaults(defineProps<AccountBadgeProps>(), { size: 16 });
const label = computed(() =>
  props.badge === 'official' ? t('Официальный аккаунт VoiceRoom') : t('Подтверждённый аккаунт')
);
</script>

<template>
  <span v-if="badge" class="ui-account-badge" role="img" :aria-label="label" :title="label">
    <BadgeCheck :size="size" :stroke-width="2.2" aria-hidden="true" />
  </span>
</template>
