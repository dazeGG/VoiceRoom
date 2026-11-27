<script setup lang="ts">
import { AccountBadge, Avatar, Badge, ListItem } from '@voiceroom/ui-kit/components';
import { iconSm } from '@voiceroom/ui-kit/icon-defaults';
import { BellOff, Phone } from '@lucide/vue';
import { computed } from 'vue';
import type { ConversationSummary } from '@voiceroom/shared/contracts/messages';
import { useFriendCallStore } from '@/features/friend-call/friend-call.store';
import { badgeOf } from '@/shared/badges';
import EmojiText from '@/shared/chat/EmojiText.vue';
import { formatNumber, getLocale, t } from '@/shared/i18n';
import type { PresenceStatus } from '@/shared/presence';
import { displayNameOf } from '@/shared/utils/display-name';

const { conversation, presence, muted, selected, inCall } = defineProps<{
  conversation: ConversationSummary;
  presence: PresenceStatus;
  muted: boolean;
  selected: boolean;
  inCall: boolean;
}>();
const emit = defineEmits<{ open: []; menu: [event: MouseEvent | KeyboardEvent] }>();
const calls = useFriendCallStore();
const missedCount = computed(() => calls.missedForPeer(conversation.peer.id)?.count ?? 0);
const missedLabel = computed(() => {
  const locale = getLocale();
  const category = new Intl.PluralRules(locale).select(missedCount.value);
  const params = { count: formatNumber(missedCount.value) };
  if (category === 'one') return t('{count} пропущенный звонок', params);
  if (locale === 'ru' && category === 'few') return t('{count} пропущенных звонка', params);
  return t('{count} пропущенных звонков', params);
});
const name = computed(() => displayNameOf(conversation.peer));
const date = computed(() => new Date(conversation.lastMessage.at));
const time = computed(() => {
  const today = date.value.toDateString() === new Date().toDateString();
  return new Intl.DateTimeFormat(
    getLocale(),
    today ? { hour: '2-digit', minute: '2-digit' } : { day: 'numeric', month: 'short' }
  ).format(date.value);
});
const preview = computed(() => {
  const { lastMessage } = conversation;
  const text =
    lastMessage.kind === 'call' ? t('Звонок') : lastMessage.kind === 'attachment' ? t('Вложение') : lastMessage.preview;
  return lastMessage.fromMe ? t('Вы: {p0}', { p0: text }) : text;
});
</script>

<template>
  <ListItem
    class="chat-row"
    interactive
    :aria-label="name"
    :aria-current="selected ? 'true' : undefined"
    aria-haspopup="menu"
    @activate="emit('open')"
    @contextmenu="emit('menu', $event)"
    @keydown="emit('menu', $event)"
  >
    <template #leading>
      <Avatar
        :name="name"
        :src="conversation.peer.avatarUrl"
        :color-key="conversation.peer.avatarColorKey"
        :background="conversation.peer.avatarAccent"
        :online="presence === 'online'"
        :afk="presence === 'away'"
        :dnd="presence === 'dnd'"
        show-dot
        :size="36"
        ring="var(--vr-surface)"
      />
    </template>
    <template #title>
      <EmojiText :text="name" /> <AccountBadge :badge="conversation.peer.badge ?? badgeOf(conversation.peer.id)" />
      <span v-if="muted" role="img" :aria-label="t('Уведомления отключены')" :title="t('Уведомления отключены')">
        <BellOff v-bind="iconSm" aria-hidden="true" />
      </span>
      <span v-if="inCall" role="img" :aria-label="t('В звонке')">
        <Phone v-bind="iconSm" aria-hidden="true" />
      </span>
    </template>
    <template #caption>
      <EmojiText :text="preview" />
    </template>
    <template #meta>
      <span class="chat-row__activity">
        <time class="chat-row__time" :datetime="date.toISOString()">{{ time }}</time>
        <span class="chat-row__badges">
          <Badge v-if="missedCount > 0" tone="danger" :count="missedCount" :label="missedLabel" />
          <Badge
            v-if="conversation.unreadCount > 0"
            :tone="muted ? 'muted' : 'accent'"
            :count="conversation.unreadCount"
            :label="t('{p0} непрочитанных', { p0: formatNumber(conversation.unreadCount) })"
          />
        </span>
      </span>
    </template>
  </ListItem>
</template>
