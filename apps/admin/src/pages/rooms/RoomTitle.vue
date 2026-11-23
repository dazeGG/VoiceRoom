<script setup lang="ts">
import { computed } from 'vue';
import type { RoomKind } from '@voiceroom/shared/contracts/admin';
import { Pill, RoomAvatar } from '../../ui';

const props = withDefaults(
  defineProps<{
    roomId: string;
    name: string | null;
    isStatic: boolean | null;
    avatarUrl?: string | null;
    kind?: RoomKind | undefined;
    size?: number;
  }>(),
  { avatarUrl: null, size: 36, kind: undefined }
);
const named = computed(() => Boolean(props.name) && props.name !== props.roomId);
</script>

<template>
  <span class="admin-room-title">
    <RoomAvatar :room-id="roomId" :name="named ? name : null" :src="avatarUrl" :size="size" />
    <span class="admin-room-title__name" :class="{ 'admin-room-title__name--code': !named }">{{
      named ? name : roomId
    }}</span>
    <Pill v-if="name === null" tone="danger" compact>удалена</Pill>
    <Pill v-else-if="kind === 'widget'" tone="info" compact>виджет</Pill>
    <Pill v-else-if="isStatic" tone="accent" compact>постоянная</Pill>
    <Pill v-else-if="isStatic === false" compact>временная</Pill>
  </span>
</template>
