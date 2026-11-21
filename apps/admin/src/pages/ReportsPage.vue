<script setup lang="ts">
import { Pressable } from '@voiceroom/ui-kit/components';
import { Flag, UserRound } from '@lucide/vue';
import { computed, ref, useId, watch } from 'vue';
import type { AdminReport } from '@voiceroom/shared/contracts/reports';
import { REPORT_REASON_LABELS } from '@voiceroom/shared/report-labels';
import { fetchOpenReports, resolveReport } from '../api/admin.ts';
import { formatCount, formatDateTime, plural } from '../format.ts';
import { useRefreshStatus } from '../frame.ts';
import Notice from '../Notice.vue';
import { Avatar, Button, Callout, Card, EmptyState, Pill } from '../ui';
import { useAdminResource } from '../use-admin-resource.ts';
import UserReports from './UserReports.vue';

const REFRESH_MS = 60_000;

/** Every open report of one message, the newest first. */
interface ReportedMessage {
  key: string;
  reports: AdminReport[];
  latest: AdminReport;
}

const keyOf = (report: AdminReport) => `${report.target.kind}:${report.target.messageId}`;

/** The reports by message, in the order the newest report of each came in. */
function byMessage(reports: readonly AdminReport[]): ReportedMessage[] {
  const groups = new Map<string, AdminReport[]>();
  for (const report of [...reports].sort((a, b) => b.createdAt - a.createdAt)) {
    const key = keyOf(report);
    const group = groups.get(key);
    if (group) group.push(report);
    else groups.set(key, [report]);
  }
  return [...groups.entries()].flatMap(([key, group]) => {
    const latest = group[0];
    return latest ? [{ key, reports: group, latest }] : [];
  });
}

const placeOf = (report: AdminReport) =>
  report.target.kind === 'room_message'
    ? `Комната «${report.target.roomName || report.target.roomId}»`
    : 'Личное сообщение';

const formatWhen = (value: number | null) => (value ? formatDateTime(value) : 'время неизвестно');

const reportsWord = (count: number) => `${formatCount(count)} ${plural(count, ['жалоба', 'жалобы', 'жалоб'])}`;

const emit = defineEmits<{ resolved: [openLeft: number]; openAccount: [accountId: string] }>();
const id = useId();
const {
  data: reports,
  failure,
  busy: loading,
  loadedAt,
  reload: load,
  update: updateReports
} = useAdminResource(fetchOpenReports, [], { failureText: 'Не удалось загрузить жалобы', refreshMs: REFRESH_MS });
const error = ref('');
const busy = ref(false);
const selected = ref<string | null>(null);
const userCount = ref<number | null>(null);
const messages = computed(() => byMessage(reports.value ?? []));
const current = computed(
  () => messages.value.find((message) => message.key === selected.value) ?? messages.value[0] ?? null
);
useRefreshStatus(() => ({ at: loadedAt.value, everyMs: REFRESH_MS, busy: loading.value, reload: load }));

watch([reports, userCount], ([open, users]) => {
  if (open && users !== null) emit('resolved', open.length + users);
});

function openAuthor(): void {
  const author = current.value?.latest.target.authorUserId;
  if (author) emit('openAccount', author);
}

async function decide(action: 'remove_message' | 'dismiss'): Promise<void> {
  const message = current.value;
  if (busy.value || !message) return;
  busy.value = true;
  error.value = '';
  try {
    await resolveReport(message.latest.id, action);
    // The server closed every open report of the same message.
    updateReports((open) => (open ?? []).filter((other) => keyOf(other) !== message.key));
  } catch (cause) {
    error.value = cause instanceof Error && cause.message ? cause.message : 'Не удалось закрыть жалобу';
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <Notice v-if="failure && !reports" :failure="failure" @retry="load" />
  <p v-else-if="!reports" class="admin-metric-note" aria-busy="true">Загружаем жалобы…</p>
  <div v-else class="admin-reports">
    <section class="admin-reports__list" :aria-labelledby="id + '-open'">
      <header class="admin-reports__heading">
        <h2 :id="id + '-open'">Открытые</h2>
        <Pill v-if="reports.length" tone="danger">{{ formatCount(reports.length) }}</Pill>
        <span class="admin-metric-note">сначала новые</span>
      </header>
      <Card v-if="messages.length === 0"><EmptyState title="Открытых жалоб нет" compact /></Card>
      <ul v-else class="admin-reports__cards" aria-label="Открытые жалобы">
        <li v-for="{ key, reports: group, latest: report } in messages" :key="key">
          <Pressable class="admin-report-card" :aria-pressed="key === current?.key" @click="selected = key">
            <span class="admin-report-card__top">
              <Pill tone="danger" compact>{{ REPORT_REASON_LABELS[report.reason] }}</Pill>
              <span v-if="group.length > 1" class="admin-report-card__many" :aria-label="reportsWord(group.length)"
                >×{{ group.length }}</span
              >
              <span class="admin-report-card__when">{{ formatWhen(report.createdAt) }}</span>
            </span>
            <span
              class="admin-report-card__text"
              :class="{ 'admin-report-card__text--deleted': report.target.deleted }"
              >{{ report.target.text || '(без текста)' }}</span
            >
            <span class="admin-report-card__place"
              >{{ placeOf(report) }} · {{ report.target.authorName || 'Без имени' }}</span
            >
          </Pressable>
        </li>
      </ul>
    </section>

    <Card v-if="current" as="section" class="admin-report-detail" :aria-labelledby="id + '-detail'">
      <header>
        <div class="admin-report-detail__title">
          <h2 :id="id + '-detail'">{{ REPORT_REASON_LABELS[current.latest.reason] }}</h2>
          <Pill v-if="current.reports.length > 1" tone="danger"
            >{{ reportsWord(current.reports.length) }} на это сообщение</Pill
          >
        </div>
        <p class="admin-metric-note">
          {{ placeOf(current.latest) }} · жалоба от {{ current.latest.reporter.displayName }}
          <span class="admin-metric-mono">@{{ current.latest.reporter.login }}</span> ·
          {{ formatWhen(current.latest.createdAt) }}
        </p>
      </header>

      <div class="admin-report-detail__message">
        <Avatar :name="current.latest.target.authorName || '?'" :size="36" />
        <div class="admin-report-detail__message-body">
          <span class="admin-report-detail__author">
            <strong>{{ current.latest.target.authorName || 'Без имени' }}</strong> ·
            {{ formatWhen(current.latest.target.sentAt) }}
            <span v-if="current.latest.target.deleted" class="admin-report-detail__gone"> · уже удалено</span>
          </span>
          <p
            class="admin-report-detail__bubble"
            :class="{ 'admin-report-detail__bubble--deleted': current.latest.target.deleted }"
          >
            {{ current.latest.target.text || '(без текста)' }}
          </p>
        </div>
      </div>

      <div
        v-if="current.reports.length > 1 || current.reports.some((report) => report.comment)"
        class="admin-report-detail__comments"
      >
        <span class="admin-metric-note">{{ current.reports.length > 1 ? 'Жалобы' : 'Комментарий к жалобе' }}</span>
        <ul>
          <li v-for="report in current.reports" :key="report.id">
            <span v-if="current.reports.length > 1" class="admin-report-detail__comment-author">
              <Flag aria-hidden="true" /> {{ report.reporter.displayName }} ·
              {{ REPORT_REASON_LABELS[report.reason] }} · {{ formatWhen(report.createdAt) }}
            </span>
            <span v-if="report.comment" class="admin-report-detail__comment">{{ report.comment }}</span>
          </li>
        </ul>
      </div>

      <Callout v-if="error" tone="danger" :title="error" role="alert" />
      <footer class="admin-report-detail__actions">
        <Button v-if="current.latest.target.authorUserId" variant="ghost" @click="openAuthor">
          <template #icon><UserRound aria-hidden="true" /></template>
          Аккаунт автора
        </Button>
        <span class="admin-report-detail__actions-note admin-metric-note"
          >Решение закроет все жалобы на это сообщение</span
        >
        <Button :disabled="busy" @click="decide('dismiss')">Отклонить</Button>
        <Button variant="danger" :disabled="busy || current.latest.target.deleted" @click="decide('remove_message')"
          >Удалить сообщение</Button
        >
      </footer>
    </Card>
  </div>
  <UserReports @resolved="userCount = $event" @open-account="emit('openAccount', $event)" />
</template>
