<script setup lang="ts">
import { MonitorUp, Video } from '@lucide/vue';
import type { LiveRoomPeer } from '@voiceroom/shared/contracts/admin';
import { formatSince } from '../../format.ts';
import { Avatar, Pill } from '../../ui';
import type { OriginPick } from './call-filters.ts';
import { CAUSE_LABELS, NETWORK_LABELS } from './network-bar.ts';
import AccountName from './AccountName.vue';
import Origin from './Origin.vue';

defineProps<{ peer: LiveRoomPeer; now: number; pick?: OriginPick | undefined; shared: boolean }>();
const emit = defineEmits<{ openAccount: [accountId: string] }>();
</script>

<template>
  <li class="admin-live__peer">
    <span class="admin-live__peer-who">
      <Avatar
        :name="peer.name"
        :src="peer.account?.avatarUrl ?? null"
        :color-key="peer.account?.avatarColorKey ?? peer.avatarColorKey"
        :background="peer.account?.avatarAccent ?? null"
        :size="28"
      />
      <span class="admin-live__peer-name">
        <span class="admin-live__peer-name-line">
          <AccountName v-if="peer.account" :account="peer.account" @open="emit('openAccount', $event)" />
          <template v-else
            ><span class="admin-room-account__name">{{ peer.name }}</span
            ><Pill compact>гость</Pill></template
          >
        </span>
        <span v-if="peer.screen || peer.camera" class="admin-live__summary">
          <span v-if="peer.screen" class="admin-live__chip" title="Показывает экран"
            ><MonitorUp aria-hidden="true" />экран</span
          >
          <span v-if="peer.camera" class="admin-live__chip" title="Камера включена"
            ><Video aria-hidden="true" />камера</span
          >
        </span>
      </span>
    </span>
    <span class="admin-live__voice">
      <span class="admin-live__voice-level" :class="'admin-network--' + (peer.network ?? 'unknown')">
        <span class="admin-network-dot" aria-hidden="true" />{{
          peer.network ? NETWORK_LABELS[peer.network] : 'нет данных'
        }}
      </span>
      <span v-if="peer.cause" class="admin-live__voice-cause">{{ CAUSE_LABELS[peer.cause] }}</span>
      <span v-if="peer.cpuPressure === 'critical' || peer.relieved" class="admin-live__summary">
        <Pill v-if="peer.cpuPressure === 'critical'" tone="danger" compact>система загружена</Pill>
        <Pill v-if="peer.relieved" tone="info" compact>облегчённый шумодав</Pill>
      </span>
    </span>
    <span class="admin-live__peer-origin"><Origin :seat="peer" :pick="pick" :shared="shared" /></span>
    <span class="admin-rooms-end admin-rooms-mono">{{
      peer.joinedAt ? (now - peer.joinedAt < 60_000 ? 'только что' : formatSince(peer.joinedAt, now)) : ''
    }}</span>
  </li>
</template>
