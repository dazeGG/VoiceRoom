<script setup lang="ts">
import { Check, UserRound } from '@lucide/vue';
import { AccountBadge as OfficialMark, Field, Textarea } from '@voiceroom/ui-kit/components';
import { computed, ref, useId, watch } from 'vue';
import {
  SUPPORT_TEXT_MAX_LENGTH,
  type SupportMessage,
  type SupportNote,
  type SupportStatus,
  type SupportThread,
  type SupportThreadList,
  type SupportThreadSummary
} from '@voiceroom/shared/contracts/support';
import { ApiError } from '../api/client.ts';
import { ERROR_TEXTS } from '../api/error-texts.ts';
import {
  fetchSupportThread,
  fetchSupportThreads,
  markSupportRead,
  noteSupport,
  replySupport,
  resolveSupport
} from '../api/support.ts';
import { formatDateTime } from '../format.ts';
import { useRefreshStatus } from '../frame.ts';
import Notice from '../Notice.vue';
import { Avatar, Button, Callout, Card, EmptyState, ListItem, Pill, SegmentControl } from '../ui';
import { useAdminResource } from '../use-admin-resource.ts';

const REFRESH_MS = 60_000;

type Mode = 'reply' | 'note';
type Entry =
  | { kind: 'message'; key: string; at: number; message: SupportMessage }
  | { kind: 'note'; key: string; at: number; note: SupportNote };

const emit = defineEmits<{ unread: [count: number]; openAccount: [accountId: string] }>();
const id = useId();
const status = ref<SupportStatus>('open');
// The conversation a staff member chose. Until they choose, the newest one is
// shown, but nobody has looked at it, so it is not marked read.
const selected = ref<string | null>(null);

const {
  data: list,
  failure,
  busy: loading,
  loadedAt,
  reload,
  update: updateList
} = useAdminResource(() => fetchSupportThreads(status.value), [status], {
  failureText: 'Не удалось загрузить обращения',
  refreshMs: REFRESH_MS
});
const threads = computed(() => list.value?.threads ?? []);
const currentId = computed(
  () =>
    threads.value.find((thread) => thread.person.id === selected.value)?.person.id ??
    threads.value[0]?.person.id ??
    null
);

function emptyList(): SupportThreadList {
  return { ok: true, threads: [], counts: { open: 0, resolved: 0 }, openUnread: 0 };
}

// Marking read: once when a staff member opens a conversation, and again when
// a refresh of the open conversation brings a new message from the person,
// both only while the page is in front of them.
let pendingRead: string | null = null;
const readThrough = new Map<string, number>();

const newestFromPerson = (shown: SupportThread) =>
  Math.max(-1, ...shown.messages.filter((message) => message.fromPerson).map((message) => message.createdAt ?? 0));

async function markSeen(shown: SupportThread): Promise<void> {
  const userId = shown.person.id;
  if (selected.value !== userId || document.visibilityState !== 'visible') return;
  const newest = newestFromPerson(shown);
  if (pendingRead !== userId && newest <= (readThrough.get(userId) ?? Number.NEGATIVE_INFINITY)) return;
  pendingRead = null;
  readThrough.set(userId, newest);
  try {
    const openUnread = await markSupportRead(userId);
    updateList((current) => {
      const base = current ?? emptyList();
      return {
        ...base,
        threads: base.threads.map((thread) => (thread.person.id === userId ? { ...thread, unread: false } : thread)),
        openUnread
      };
    });
  } catch {
    // Still unread on the server: the next refresh or open tries again.
    readThrough.delete(userId);
  }
}

const {
  data: thread,
  failure: threadFailure,
  reload: reloadThread,
  update: updateThread
} = useAdminResource(
  async () => {
    const userId = currentId.value;
    if (!userId) return null;
    const shown = await fetchSupportThread(userId);
    void markSeen(shown);
    return shown;
  },
  [currentId],
  { failureText: 'Не удалось загрузить переписку', refreshMs: REFRESH_MS }
);
useRefreshStatus(() => ({ at: loadedAt.value, everyMs: REFRESH_MS, busy: loading.value, reload }));

watch(
  () => list.value?.openUnread,
  (count) => {
    if (count !== undefined) emit('unread', count);
  }
);

/** A staff member opens a conversation: it is loaded afresh and then marked read. */
function choose(userId: string): void {
  const shownAlready = currentId.value === userId;
  selected.value = userId;
  pendingRead = userId;
  if (shownAlready) reloadThread();
}

const segments = computed(() => [
  { value: 'open' as const, label: 'Открытые', count: list.value?.counts.open ?? 0 },
  { value: 'resolved' as const, label: 'Решённые', count: list.value?.counts.resolved ?? 0 }
]);

function chooseStatus(next: SupportStatus): void {
  status.value = next;
  selected.value = null;
}

const timeline = computed<Entry[]>(() => {
  const current = thread.value;
  if (!current) return [];
  const entries: Entry[] = [
    ...current.messages.map((message) => ({
      kind: 'message' as const,
      key: 'm:' + message.id,
      at: message.createdAt ?? 0,
      message
    })),
    ...current.notes.map((note) => ({ kind: 'note' as const, key: 'n:' + note.id, at: note.createdAt, note }))
  ];
  return entries.sort((a, b) => a.at - b.at);
});

const mode = ref<Mode>('reply');
const draft = ref('');
const sending = ref(false);
const resolving = ref(false);
const error = ref('');
// Why VoiceRoom cannot answer here; notes stay open either way.
const closedReason = computed(() => {
  const current = thread.value;
  if (!current) return null;
  if (current.personState === 'deleted') return 'Аккаунт удалён';
  if (current.personState === 'blocked') return 'Аккаунт заблокирован';
  return null;
});
const replyClosed = computed(() => Boolean(thread.value?.conversationDeleted || closedReason.value));
const activeMode = computed<Mode>(() => (replyClosed.value ? 'note' : mode.value));
const modes = computed(() => [
  { value: 'reply' as const, label: 'Ответ от VoiceRoom', disabled: replyClosed.value },
  { value: 'note' as const, label: 'Заметка для команды' }
]);
const placeholder = computed(() =>
  activeMode.value === 'note'
    ? 'Заметка видна только команде…'
    : `Ответить ${thread.value?.person.displayName ?? ''} от имени VoiceRoom…`
);

function chooseMode(next: Mode): void {
  mode.value = next;
  error.value = '';
}

const failureText = (cause: unknown, fallback: string) =>
  cause instanceof Error && cause.message ? cause.message : fallback;

function withThread(change: (current: SupportThread) => SupportThread): void {
  updateThread((current) => (current ? change(current) : current));
}

// One key per answer: a retry after a lost response repeats it, so the person gets it once.
let pendingReply: { userId: string; text: string; key: string } | null = null;

function replyKey(userId: string, text: string): string {
  if (pendingReply?.userId !== userId || pendingReply.text !== text)
    pendingReply = { userId, text, key: crypto.randomUUID() };
  return pendingReply.key;
}

async function send(): Promise<void> {
  const current = thread.value;
  const text = draft.value.trim();
  if (!current || !text || sending.value) return;
  const userId = current.person.id;
  sending.value = true;
  error.value = '';
  try {
    if (activeMode.value === 'reply') {
      const message = await replySupport(userId, text, replyKey(userId, text));
      pendingReply = null;
      // Answering is looking: later messages of the person get marked read.
      selected.value = userId;
      withThread((value) => ({ ...value, messages: [...value.messages, message] }));
      reload();
    } else {
      const note = await noteSupport(userId, text);
      withThread((value) => ({ ...value, notes: [...value.notes, note] }));
    }
    draft.value = '';
  } catch (cause) {
    error.value = failureText(cause, 'Не удалось отправить');
  } finally {
    sending.value = false;
  }
}

async function resolve(): Promise<void> {
  const current = thread.value;
  if (!current || resolving.value) return;
  const userId = current.person.id;
  resolving.value = true;
  error.value = '';
  try {
    if (selected.value !== userId) {
      // Only shown so far: open it for real, so staff resolve what they see.
      selected.value = userId;
      pendingRead = userId;
      const fresh = await fetchSupportThread(userId);
      updateThread(() => fresh);
      await markSeen(fresh);
      if (newestFromPerson(fresh) > newestFromPerson(current)) {
        error.value = ERROR_TEXTS.support_thread_changed;
        return;
      }
    }
    const resolved = await resolveSupport(userId);
    withThread((value) => ({ ...value, status: resolved.status, resolvedAt: resolved.resolvedAt }));
    reload();
  } catch (cause) {
    error.value = failureText(cause, 'Не удалось отметить решённым');
    // The person wrote meanwhile: show it, and the refresh marks it read.
    if (cause instanceof ApiError && cause.code === 'support_thread_changed') reloadThread();
  } finally {
    resolving.value = false;
  }
}

const formatWhen = (value: number | null) => (value ? formatDateTime(value) : '');

function preview(summary: SupportThreadSummary): string {
  const last = summary.lastMessage;
  if (!last) return 'Человек удалил переписку';
  const text = last.text || (last.hasAttachments ? 'Изображение' : '');
  return last.fromStaff ? 'Вы: ' + text : text;
}

const nameOf = (person: SupportThread['person']) => person.displayName || person.login;

const avatarOf = (who: {
  displayName: string;
  avatarUrl: string | null;
  avatarColorKey: string;
  avatarAccent: string | null;
}) => ({
  name: who.displayName,
  src: who.avatarUrl,
  colorKey: who.avatarColorKey,
  background: who.avatarAccent
});
</script>

<template>
  <Notice v-if="failure && !list" :failure="failure" @retry="reload" />
  <p v-else-if="!list" class="admin-metric-note" aria-busy="true">Загружаем обращения…</p>
  <div v-else class="admin-support">
    <section class="admin-support__list" aria-label="Обращения">
      <SegmentControl
        kind="tabs"
        size="sm"
        :options="segments"
        :value="status"
        v-bind="{ ariaLabel: 'Обращения по статусу' }"
        @change="chooseStatus"
      />
      <Card v-if="threads.length === 0">
        <EmptyState :title="status === 'open' ? 'Открытых обращений нет' : 'Решённых обращений нет'" compact />
      </Card>
      <ul v-else class="admin-support__threads" :aria-label="status === 'open' ? 'Открытые' : 'Решённые'">
        <li v-for="summary in threads" :key="summary.person.id">
          <ListItem
            interactive
            :selected="summary.person.id === currentId"
            :avatar="avatarOf({ ...summary.person, displayName: nameOf(summary.person) })"
            :caption="preview(summary)"
            @activate="choose(summary.person.id)"
          >
            <template #title>
              {{ nameOf(summary.person) }}
              <span class="admin-metric-mono admin-metric-note">@{{ summary.person.login }}</span>
            </template>
            <template #meta>
              <span class="admin-metric-note">{{ formatWhen(summary.lastMessage?.at ?? null) }}</span>
              <Pill v-if="summary.unread" tone="accent" dot compact>не прочитано</Pill>
            </template>
          </ListItem>
        </li>
      </ul>
    </section>

    <Card v-if="currentId" as="section" class="admin-support-chat" :aria-labelledby="id + '-chat'">
      <Notice v-if="threadFailure && !thread" :failure="threadFailure" @retry="reloadThread" />
      <p v-else-if="!thread" class="admin-metric-note" aria-busy="true">Загружаем переписку…</p>
      <template v-else>
        <header class="admin-support-chat__header">
          <Avatar v-bind="avatarOf({ ...thread.person, displayName: nameOf(thread.person) })" :size="40" />
          <span class="admin-support-chat__who">
            <h3 :id="id + '-chat'" class="admin-panel__title">{{ nameOf(thread.person) }}</h3>
            <Button variant="plain" size="inline" @click="emit('openAccount', thread.person.id)">
              <template #icon><UserRound aria-hidden="true" /></template>
              @{{ thread.person.login }} · открыть аккаунт
            </Button>
          </span>
          <Button v-if="thread.status === 'open'" :disabled="resolving" @click="resolve">
            <template #icon><Check aria-hidden="true" /></template>
            Отметить решённым
          </Button>
          <Pill v-else tone="success">Решено {{ formatWhen(thread.resolvedAt) }}</Pill>
        </header>

        <Callout
          v-if="thread.conversationDeleted"
          tone="warning"
          title="Человек удалил переписку"
          text="Заметки и статус остались, ответить уже нельзя."
        />
        <Callout
          v-else-if="closedReason"
          tone="info"
          :title="closedReason"
          text="Ответить от VoiceRoom нельзя, заметки для команды остаются."
        />

        <ol class="admin-support-chat__timeline" aria-label="Переписка">
          <li v-for="entry in timeline" :key="entry.key">
            <Callout v-if="entry.kind === 'note'" tone="info" title="Заметка для команды" role="note">
              <p class="admin-support-note__body">{{ entry.note.body }}</p>
              <p class="admin-support-note__meta admin-metric-note">
                {{ entry.note.authorName }}, {{ formatWhen(entry.note.createdAt) }}
              </p>
            </Callout>
            <div v-else class="admin-support-message">
              <Avatar
                v-if="entry.message.fromPerson"
                v-bind="avatarOf({ ...thread.person, displayName: nameOf(thread.person) })"
                :size="32"
              />
              <Avatar v-else v-bind="avatarOf(thread.official)" :size="32" shape="squircle" />
              <div class="admin-support-message__body">
                <span class="admin-support-message__author">
                  <strong>{{ entry.message.fromPerson ? nameOf(thread.person) : thread.official.displayName }}</strong>
                  <OfficialMark v-if="!entry.message.fromPerson" badge="official" :size="16" />
                  <span class="admin-metric-note">
                    {{ formatWhen(entry.message.createdAt)
                    }}<template v-if="entry.message.staffName"> · ответил {{ entry.message.staffName }}</template>
                  </span>
                </span>
                <p v-if="entry.message.body" class="admin-support-message__text">{{ entry.message.body }}</p>
                <span v-if="entry.message.attachments.length" class="admin-support-message__images">
                  <template v-for="attachment in entry.message.attachments" :key="attachment.id">
                    <img
                      v-if="attachment.url"
                      class="admin-support-message__image"
                      :src="attachment.url"
                      :width="attachment.width ?? undefined"
                      :height="attachment.height ?? undefined"
                      alt="Изображение из переписки"
                      loading="lazy"
                    />
                  </template>
                </span>
              </div>
            </div>
          </li>
        </ol>

        <form class="admin-support-composer" @submit.prevent="send">
          <SegmentControl
            size="sm"
            :options="modes"
            :value="activeMode"
            v-bind="{ ariaLabel: 'Что отправить' }"
            @change="chooseMode"
          />
          <Field :id="id + '-draft'" :label="activeMode === 'note' ? 'Заметка' : 'Ответ'">
            <Textarea
              v-model="draft"
              :maxlength="SUPPORT_TEXT_MAX_LENGTH"
              :show-count="false"
              :placeholder="placeholder"
              :rows="3"
            />
          </Field>
          <Callout v-if="error" tone="danger" :title="error" role="alert" />
          <div class="admin-support-composer__actions">
            <Button type="submit" :disabled="sending || !draft.trim()">
              {{ activeMode === 'note' ? 'Сохранить заметку' : 'Отправить' }}
            </Button>
          </div>
        </form>
      </template>
    </Card>
  </div>
</template>
