<script setup lang="ts">
// The mark next to a name: the service's own account (later also a
// verified person). Nothing for everyone else.
import { BadgeCheck } from '@lucide/vue';
import { computed } from 'vue';

import { badgeOf } from '@/shared/badges';

const props = withDefaults(defineProps<{ userId: string | null | undefined; size?: number }>(), { size: 15 });

const badge = computed(() => badgeOf(props.userId));
const label = computed(() => (badge.value === 'official' ? 'Официальный аккаунт VoiceRoom' : 'Подтверждённый аккаунт'));
</script>

<template>
  <span v-if="badge" :class="['account-badge', `account-badge--${badge}`]" role="img" :aria-label="label" :title="label"
    ><BadgeCheck :size="size" :stroke-width="2.2" aria-hidden="true"
  /></span>
</template>
