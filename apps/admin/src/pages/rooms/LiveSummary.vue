<script setup lang="ts">
import { computed } from 'vue';
import { MonitorUp, Video } from '@lucide/vue';
import type { LiveRoomPeer } from '@voiceroom/shared/contracts/admin';
import { Pill } from '../../ui';
import ClientIcon from './ClientIcon.vue';
import { troubleOf } from './live-quality.ts';

const props = defineProps<{ peers: readonly LiveRoomPeer[] }>();
const trouble = computed(() => troubleOf(props.peers));
const screens = computed(() => props.peers.filter((peer) => peer.screen).length);
const cameras = computed(() => props.peers.filter((peer) => peer.camera).length);
const clients = computed(() => [
  ...new Set(props.peers.map((peer) => peer.client).filter((client) => client !== null))
]);
</script>

<template>
  <span class="admin-live__summary">
    <Pill v-if="trouble" :tone="trouble.tone" dot compact>{{ trouble.count }} со связью</Pill>
    <span
      v-if="screens"
      class="admin-live__chip admin-live__chip--accent"
      title="Показывают экран"
      :aria-label="`показывают экран: ${screens}`"
      ><MonitorUp aria-hidden="true" />{{ screens }}</span
    >
    <span
      v-if="cameras"
      class="admin-live__chip admin-live__chip--accent"
      title="С камерой"
      :aria-label="`с камерой: ${cameras}`"
      ><Video aria-hidden="true" />{{ cameras }}</span
    >
    <ClientIcon v-for="client in clients" :key="client" :client="client" />
  </span>
</template>
