<script setup lang="ts">
import { Tooltip, Button, IconButton, Badge, EmptyState, ListItem } from '@voice-room/ui/components';
// The panel you reach from the bell. It answers two questions — what happened
// and how long ago — and offers exactly one bulk action. "К первому
// непрочитанному" is gone: every unread row is already one click away, and
// the two buttons together overflowed the header into a horizontal scrollbar.
import { t } from '@/shared/i18n';
import { Bell, Check, CircleAlert, X } from '@lucide/vue';
import { onBeforeUnmount, onMounted } from 'vue';
import type { InboxItem, NotificationReason } from '@voice-room/shared/contracts/notifications';
import EmojiText from '@/shared/chat/EmojiText.vue';
import type { createNotificationInbox } from '@/shared/notifications/inbox';
import { iconSm } from '@/shared/ui/icons';
import { timeAgo } from '@/shared/utils/date-format';

type Inbox = ReturnType<typeof createNotificationInbox>;

const props = defineProps<{
  inbox: Inbox;
  /** Name of the room a notification came from. */
  roomLabel?: (roomId: string) => string;
  /** A callback prop: the panel has a close button only when someone listens. */
  onClose?: () => void;
}>();

const emit = defineEmits<{ open: [item: InboxItem] }>();

const REASON_LABELS: Record<NotificationReason, string> = {
  get mention() {
    return t('Упоминание');
  },
  get reply() {
    return t('Ответ');
  }
};

const SKELETON_WIDTHS = [72, 58, 84, 64];

function reasonLabel(reasons: NotificationReason[]): string {
  return reasons.map((reason) => REASON_LABELS[reason] ?? reason).join(' · ');
}

function agoLabel(at: number | null): string {
  return at === null || !Number.isFinite(at) ? '' : timeAgo(at, Date.now());
}

function open(item: InboxItem): void {
  void props.inbox.markRead(item.id);
  emit('open', item);
}

// Escape closes the panel, unless it belongs to something above it: an open
// modal dialog (settings over the panel) or a handler that took the key. The
// room keeps its guest-name and screen-source dialogs mounted but hidden.
function onWindowKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Escape' || event.defaultPrevented) return;
  const modals = document.querySelectorAll('[aria-modal="true"]');
  if ([...modals].some((modal) => !modal.closest('[hidden]'))) return;
  props.onClose?.();
}

onMounted(() => window.addEventListener('keydown', onWindowKeydown));
onBeforeUnmount(() => window.removeEventListener('keydown', onWindowKeydown));
</script>

<template>
  <section class="notification-inbox" aria-labelledby="notification-inbox-title">
    <header class="notification-inbox__head">
      <h2 id="notification-inbox-title" class="notification-inbox__title">
        {{ t('Уведомления') }}
        <span v-if="inbox.unreadCount" class="notification-inbox__count">{{ inbox.unreadCount }}</span>
      </h2>
      <div class="notification-inbox__tools">
        <Tooltip :text="t('Отметить все прочитанными')"
          ><Button v-if="inbox.unreadCount" variant="plain" size="sm" @click="void inbox.markAllRead()">
            <template #icon><Check v-bind="iconSm" aria-hidden="true" /></template>
            <span>{{ t('Прочитать все') }}</span>
          </Button></Tooltip
        >
        <IconButton v-if="onClose" :label="t('Закрыть')" :size="32" @click="onClose">
          <X aria-hidden="true" />
        </IconButton>
      </div>
    </header>

    <div aria-live="polite" class="notification-inbox__live">
      {{ inbox.loading ? t('Загрузка уведомлений') : t('{p0} непрочитанных', { p0: inbox.unreadCount }) }}
    </div>

    <div class="notification-inbox__body">
      <div v-if="inbox.error" class="notification-inbox__state">
        <span class="notification-inbox__glyph notification-inbox__glyph--error"
          ><CircleAlert :size="20" aria-hidden="true"
        /></span>
        <p role="alert">{{ inbox.error }}</p>
        <button class="notification-inbox__retry" type="button" @click="void inbox.load()">{{ t('Повторить') }}</button>
      </div>
      <div v-else-if="inbox.loading && inbox.items.length === 0" class="notification-inbox__skeleton">
        <div
          v-for="(width, index) in SKELETON_WIDTHS"
          :key="index"
          class="notification-inbox__skeleton-row"
          aria-hidden="true"
        >
          <span class="notification-inbox__dot notification-inbox__dot--skeleton"></span>
          <span class="notification-inbox__skeleton-lines">
            <span class="notification-inbox__skeleton-line" :style="{ width: `${width}%` }"></span>
            <span class="notification-inbox__skeleton-line notification-inbox__skeleton-line--short"></span>
          </span>
        </div>
        <p>{{ t('Загружаем…') }}</p>
      </div>
      <EmptyState v-else-if="inbox.items.length === 0" :title="t('Новых уведомлений нет')" compact>
        <template #icon><Bell /></template>
      </EmptyState>
      <template v-else>
        <ul class="notification-inbox__list">
          <li v-for="item in inbox.items" :key="item.id" class="notification-inbox__item">
            <ListItem interactive :time="agoLabel(item.createdAt)" @activate="open(item)">
              <template #leading>
                <Badge v-if="!item.readAt" variant="dot" aria-hidden="true" />
                <span v-else class="notification-inbox__dot" aria-hidden="true"></span>
              </template>
              <template #title>
                <span :class="{ 'notification-inbox__message--retracted': item.retractedAt }">
                  <EmojiText
                    :text="item.retractedAt ? t('Сообщение недоступно') : item.body || t('Новое уведомление')"
                  />
                </span>
              </template>
              <template #caption>
                {{ reasonLabel(item.reasons) }}
                <template v-if="roomLabel?.(item.roomId)"> · {{ roomLabel(item.roomId) }}</template>
              </template>
            </ListItem>
          </li>
        </ul>
        <button
          v-if="inbox.hasMore"
          class="notification-inbox__more"
          type="button"
          :disabled="inbox.loading"
          @click="void inbox.load(true)"
        >
          {{ inbox.loading ? t('Загружаем…') : t('Показать ещё') }}
        </button>
      </template>
    </div>
  </section>
</template>
