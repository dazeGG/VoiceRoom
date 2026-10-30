<script setup lang="ts">
// The panel you reach from the bell. It answers two questions — what happened
// and how long ago — and offers exactly one bulk action. "К первому
// непрочитанному" is gone: every unread row is already one click away, and
// the two buttons together overflowed the header into a horizontal scrollbar.
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
  mention: 'Упоминание',
  reply: 'Ответ'
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
        Уведомления
        <span v-if="inbox.unreadCount" class="notification-inbox__count">{{ inbox.unreadCount }}</span>
      </h2>
      <div class="notification-inbox__tools">
        <button
          v-if="inbox.unreadCount"
          class="notification-inbox__read-all"
          type="button"
          title="Отметить все прочитанными"
          @click="void inbox.markAllRead()"
        >
          <Check v-bind="iconSm" aria-hidden="true" />
          <span>Прочитать все</span>
        </button>
        <button v-if="onClose" class="notification-inbox__dismiss" type="button" aria-label="Закрыть" @click="onClose">
          <X v-bind="iconSm" aria-hidden="true" />
        </button>
      </div>
    </header>

    <div aria-live="polite" class="notification-inbox__live">
      {{ inbox.loading ? 'Загрузка уведомлений' : `${inbox.unreadCount} непрочитанных` }}
    </div>

    <div class="notification-inbox__body">
      <div v-if="inbox.error" class="notification-inbox__state">
        <span class="notification-inbox__glyph notification-inbox__glyph--error"
          ><CircleAlert :size="20" aria-hidden="true"
        /></span>
        <p role="alert">{{ inbox.error }}</p>
        <button class="notification-inbox__retry" type="button" @click="void inbox.load()">Повторить</button>
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
        <p>Загружаем…</p>
      </div>
      <div v-else-if="inbox.items.length === 0" class="notification-inbox__state">
        <span class="notification-inbox__glyph"><Bell :size="20" aria-hidden="true" /></span>
        <p>Новых уведомлений нет</p>
      </div>
      <template v-else>
        <ul class="notification-inbox__list">
          <li
            v-for="item in inbox.items"
            :key="item.id"
            class="notification-inbox__item"
            :class="{ 'notification-inbox__item--unread': !item.readAt }"
          >
            <button class="notification-inbox__open" type="button" @click="open(item)">
              <span class="notification-inbox__dot" aria-hidden="true"></span>
              <span class="notification-inbox__text">
                <strong
                  class="notification-inbox__message"
                  :class="{ 'notification-inbox__message--retracted': Boolean(item.retractedAt) }"
                  ><EmojiText :text="item.retractedAt ? 'Сообщение недоступно' : item.body || 'Новое уведомление'"
                /></strong>
                <small class="notification-inbox__meta">
                  <span class="notification-inbox__reason">{{ reasonLabel(item.reasons) }}</span>
                  <span v-if="roomLabel?.(item.roomId)" class="notification-inbox__room">{{
                    roomLabel(item.roomId)
                  }}</span>
                  <template v-if="agoLabel(item.createdAt)">
                    <span aria-hidden="true">·</span>
                    <span class="notification-inbox__time">{{ agoLabel(item.createdAt) }}</span>
                  </template>
                </small>
              </span>
            </button>
          </li>
        </ul>
        <button
          v-if="inbox.hasMore"
          class="notification-inbox__more"
          type="button"
          :disabled="inbox.loading"
          @click="void inbox.load(true)"
        >
          {{ inbox.loading ? 'Загружаем…' : 'Показать ещё' }}
        </button>
      </template>
    </div>
  </section>
</template>
