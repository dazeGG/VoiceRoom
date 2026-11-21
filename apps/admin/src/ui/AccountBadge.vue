<script setup lang="ts">
import { BadgeCheck } from '@lucide/vue';
import { Badge, Tooltip } from '@voice-room/ui/components';
import { computed, onMounted, shallowRef } from 'vue';
import type { AccountBadge } from '@voice-room/shared/contracts/users';
import { loadBadges } from '../badges.ts';

const props = defineProps<{ userId: string }>();
const badges = shallowRef<ReadonlyMap<string, AccountBadge>>(new Map());
onMounted(async () => {
  badges.value = await loadBadges();
});
const badge = computed(() => badges.value.get(props.userId));
const label = computed(() => (badge.value === 'official' ? 'Официальный аккаунт' : 'Подтверждённый аккаунт'));
</script>

<template>
  <Tooltip v-if="badge" :text="label">
    <Badge :tone="badge === 'official' ? 'accent' : 'soft'" size="sm" role="img" :aria-label="label">
      <BadgeCheck class="admin-account-badge__icon" aria-hidden="true" />
    </Badge>
  </Tooltip>
</template>
