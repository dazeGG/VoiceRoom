<script setup lang="ts">
import { AccountBadge, Avatar, Badge, Pressable } from '@voiceroom/ui-kit/components';
import { iconSm } from '@voiceroom/ui-kit/icon-defaults';
import { BellOff, Phone, PhoneMissed } from '@lucide/vue';
import { computed } from 'vue';
import type { Friend } from '@/api/friends';
import { useFriendCallStore } from '@/features/friend-call/friend-call.store';
import { badgeOf } from '@/shared/badges';
import EmojiText from '@/shared/chat/EmojiText.vue';
import { formatNumber, getLocale, t } from '@/shared/i18n';
import { effectivePresenceStatus } from '@/shared/presence';
import { displayNameOf } from '@/shared/utils/display-name';

const { friend, muted, selected, inCall } = defineProps<{
  friend: Friend;
  muted: boolean;
  selected: boolean;
  inCall: boolean;
}>();
const emit = defineEmits<{ open: []; menu: [event: MouseEvent | KeyboardEvent] }>();
const calls = useFriendCallStore();
const presence = computed(() =>
  effectivePresenceStatus(friend.online, friend.user.presenceStatus, friend.user.doNotDisturb)
);
const missedCount = computed(() => calls.missedForPeer(friend.user.id)?.count ?? 0);
const missedLabel = computed(() => {
  const locale = getLocale();
  const category = new Intl.PluralRules(locale).select(missedCount.value);
  const params = { count: formatNumber(missedCount.value) };
  if (category === 'one') return t('{count} пропущенный звонок', params);
  if (locale === 'ru' && category === 'few') return t('{count} пропущенных звонка', params);
  return t('{count} пропущенных звонков', params);
});
const name = computed(() => displayNameOf(friend.user));
</script>

<template>
  <Pressable
    inset
    class="sidebar__row"
    :class="{ 'sidebar__row--missed': missedCount > 0 }"
    aria-haspopup="menu"
    :aria-current="selected ? 'true' : undefined"
    @click="emit('open')"
    @contextmenu="emit('menu', $event)"
    @keydown="emit('menu', $event)"
  >
    <Avatar
      :name="name"
      :src="friend.user.avatarUrl"
      :color-key="friend.user.avatarColorKey"
      :background="friend.user.avatarAccent || undefined"
      :online="presence === 'online'"
      :afk="presence === 'away'"
      :dnd="presence === 'dnd'"
      show-dot
      :size="32"
      ring="var(--vr-surface)"
    />
    <span class="sidebar__row-body">
      <span class="sidebar__row-title">
        <span class="sidebar__row-name"
          ><EmojiText :text="name" /><AccountBadge :badge="badgeOf(friend.user.id)"
        /></span>
        <span
          v-if="muted"
          class="sidebar__row-muted"
          role="img"
          :aria-label="t('Уведомления отключены')"
          :title="t('Уведомления отключены')"
        >
          <BellOff v-bind="iconSm" aria-hidden="true" />
        </span>
      </span>
      <span v-if="missedCount > 0" class="sidebar__row-missed">
        <PhoneMissed v-bind="iconSm" aria-hidden="true" />
        <span>{{ t('Пропущенный звонок') }}</span>
      </span>
    </span>
    <span v-if="inCall" class="sidebar__row-call" role="img" :aria-label="t('В звонке')">
      <Phone v-bind="iconSm" aria-hidden="true" />
    </span>
    <Badge v-if="missedCount > 0" tone="danger" :count="missedCount" :label="missedLabel" />
    <Badge v-if="friend.unreadCount > 0" :tone="muted ? 'muted' : 'accent'" :count="friend.unreadCount" />
  </Pressable>
</template>
