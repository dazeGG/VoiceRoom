<script setup lang="ts">
import { AccountBadge, IconButton, ListItem } from '@voiceroom/ui-kit/components';
import { Ellipsis, MessageSquare } from '@lucide/vue';
import { computed } from 'vue';
import type { Friend } from '@/api/friends';
import CallEntryIcon from '@/features/friend-call/CallEntryIcon.vue';
import { useCallEntry } from '@/features/friend-call/use-call-entry';
import { badgeOf } from '@/shared/badges';
import EmojiText from '@/shared/chat/EmojiText.vue';
import { t } from '@/shared/i18n';
import { effectivePresenceStatus, presenceStatusLabel } from '@/shared/presence';
import { displayNameOf } from '@/shared/utils/display-name';

const { friend, menuOpen } = defineProps<{ friend: Friend; menuOpen: boolean }>();
const emit = defineEmits<{ open: []; menu: [event: MouseEvent] }>();
const name = computed(() => displayNameOf(friend.user));
const presence = computed(() =>
  effectivePresenceStatus(friend.online, friend.user.presenceStatus, friend.user.doNotDisturb)
);
const call = useCallEntry(
  () => friend.user.id,
  () => friend.online
);
</script>

<template>
  <ListItem
    :avatar="{
      name,
      src: friend.user.avatarUrl,
      colorKey: friend.user.avatarColorKey,
      background: friend.user.avatarAccent,
      online: presence === 'online',
      afk: presence === 'away',
      dnd: presence === 'dnd',
      showDot: true
    }"
    :caption="presenceStatusLabel(presence)"
  >
    <template #title
      ><EmojiText :text="name" /> <AccountBadge :badge="badgeOf(friend.user.id)" /> @{{ friend.user.login }}</template
    >
    <template #actions>
      <IconButton :label="t('Написать')" :size="32" @click="emit('open')"
        ><MessageSquare aria-hidden="true"
      /></IconButton>
      <IconButton
        v-if="call.visible"
        :label="call.label"
        :tooltip-description="call.description"
        :size="32"
        :disabled="call.disabled"
        @click="call.open()"
        ><CallEntryIcon :mode="call.mode"
      /></IconButton>
      <IconButton
        :label="t('Ещё')"
        :size="32"
        aria-haspopup="menu"
        :aria-expanded="menuOpen"
        @click="emit('menu', $event)"
      >
        <Ellipsis aria-hidden="true" />
      </IconButton>
    </template>
  </ListItem>
</template>
