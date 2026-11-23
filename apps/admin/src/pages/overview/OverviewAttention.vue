<script setup lang="ts">
import { Flag } from '@lucide/vue';
import { computed } from 'vue';
import type { AdminOverview, LiveRoom, RoomCall } from '@voiceroom/shared/contracts/admin';
import { REPORT_REASON_LABELS } from '@voiceroom/shared/report-labels';
import { formatCount, formatPeople, formatSince, plural } from '../../format.ts';
import type { AdminTab, CallRef } from '../../tabs.ts';
import { Button, Card, Pill, Section } from '../../ui';
import { troubleOf } from '../rooms/live-quality.ts';
import { badFeedbackTags, roomName, tagLabel } from './overview-details.ts';

const props = defineProps<{
  overview: AdminOverview;
  rooms: readonly LiveRoom[] | null;
  calls: readonly RoomCall[] | null;
  canReview: boolean;
  now: number;
}>();
const emit = defineEmits<{
  openReports: [];
  openTab: [tab: AdminTab];
  openAccount: [accountId: string];
  openCall: [call: CallRef];
}>();

const cards = computed(() => {
  const { overview, rooms, calls, canReview, now } = props;
  const attention: {
    id: string;
    label: string;
    value: string;
    detail: string;
    tone: 'danger' | 'warning';
    action: string;
    open: () => void;
  }[] = [];
  if (canReview && overview.openReports > 0) {
    const reasons = (overview.reports?.reasons ?? []).map((reason) => REPORT_REASON_LABELS[reason].toLowerCase());
    const oldest = overview.reports?.oldestAt ?? null;
    attention.push({
      id: 'reports',
      label: 'Открытые жалобы',
      value: formatCount(overview.openReports),
      detail: [oldest === null ? '' : `самая старая — ${formatSince(oldest, now)} назад`, reasons.join(', ')]
        .filter(Boolean)
        .join(' · '),
      tone: 'danger',
      action: 'Разобрать',
      open: () => emit('openReports')
    });
  }

  const troubled = (rooms ?? []).flatMap((room) => {
    const trouble = troubleOf(room.peers);
    return trouble ? [{ room, count: trouble.count }] : [];
  });
  const troubledPeople = troubled.reduce((sum, { count }) => sum + count, 0);
  if (troubledPeople > 0) {
    attention.push({
      id: 'voice',
      label: 'Связь хуже нормы сейчас',
      value: formatPeople(troubledPeople),
      detail: troubled.map(({ room, count }) => `${roomName(room)} — ${formatCount(count)}`).join(' · '),
      tone: 'danger',
      action: 'Открыть звонки',
      open: () => emit('openTab', 'rooms')
    });
  }

  const overloaded = (rooms ?? []).flatMap((room) => room.peers).filter((peer) => peer.cpuPressure === 'critical');
  if (overloaded.length > 0) {
    const account = overloaded.find((peer) => peer.account)?.account;
    attention.push({
      id: 'cpu',
      label: 'Процессор клиента в critical',
      value: `${formatCount(overloaded.length)} ${plural(overloaded.length, ['клиент', 'клиента', 'клиентов'])}`,
      detail: [
        overloaded.map((peer) => peer.name).join(', '),
        overloaded.some((peer) => peer.relieved) ? 'облегчённый шумодав включён' : ''
      ]
        .filter(Boolean)
        .join(' · '),
      tone: 'warning',
      action: 'Кто это',
      open: () => (account ? emit('openAccount', account.id) : emit('openTab', 'rooms'))
    });
  }

  const day = overview.feedback?.day;
  if (day?.bad) {
    const call = calls?.find((item) => item.badFeedback);
    attention.push({
      id: 'feedback',
      label: 'Плохие отзывы за сутки',
      value: `${formatCount(day.bad)} из ${formatCount(day.good + day.bad)}`,
      detail: badFeedbackTags(day.tags)
        .slice(0, 2)
        .map(({ tag }) => tagLabel(tag).toLowerCase())
        .join(' · '),
      tone: 'warning',
      action: call ? 'К звонку' : 'Все отзывы',
      open: () => (call ? emit('openCall', { kind: 'finished', callId: call.id }) : emit('openTab', 'feedback'))
    });
  }
  return attention;
});
</script>

<template>
  <Section id="attention" page="overview" title="Требует внимания">
    <template #summary
      ><Pill v-if="cards.length" tone="danger" dot>{{ formatCount(cards.length) }}</Pill></template
    >
    <div v-if="cards.length" class="admin-attention">
      <Card
        v-for="card in cards"
        :key="card.id"
        class="admin-attention__card"
        :class="{ 'admin-attention__card--urgent': card.id === 'reports' }"
      >
        <span class="admin-attention__label" :class="'admin-tone--' + card.tone">
          <Flag v-if="card.id === 'reports'" aria-hidden="true" />
          <span v-else class="admin-attention__dot" aria-hidden="true" />
          {{ card.label }}
        </span>
        <strong class="admin-attention__value">{{ card.value }}</strong>
        <span v-if="card.detail" class="admin-metric-note">{{ card.detail }}</span>
        <div class="admin-attention__action">
          <Button size="sm" :variant="card.id === 'reports' ? 'danger' : 'plain'" @click="card.open">{{
            card.action
          }}</Button>
        </div>
      </Card>
    </div>
    <p v-else class="admin-metric-note">Всё спокойно</p>
  </Section>
</template>
