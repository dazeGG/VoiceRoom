<script setup lang="ts">
import { computed } from 'vue';
import { ThumbsDown, ThumbsUp } from '@lucide/vue';
import type { AdminCallFeedbackEntry } from '@voice-room/shared/contracts/feedback';
import { CALL_FEEDBACK_TAG_LABELS } from '@voice-room/shared/feedback-labels';
import { formatClock, formatCount, formatMinutes, formatPercent, plural } from '../../format.ts';
import { EmptyState, Panel, Pill } from '../../ui';

const props = defineProps<{ entries: readonly AdminCallFeedbackEntry[] }>();
const bad = computed(() => props.entries.filter((entry) => entry.rating === 'bad').length);
function feedbackLine(entry: AdminCallFeedbackEntry): string {
  const quality = entry.quality;
  const parts = [formatMinutes(entry.durationS / 60), `собеседников ${formatCount(entry.peers)}`];
  if (quality) {
    const loss = Math.max(quality.inboundLossAvgPct ?? 0, quality.outboundLossAvgPct ?? 0);
    parts.push(`потери ${formatPercent(loss)}`);
    if (quality.appCpuAvgPct !== undefined && quality.appCpuAvgPct !== null) {
      parts.push(
        `процессор: VoiceRoom ${formatPercent(quality.appCpuAvgPct)}${
          quality.systemCpuAvgPct === undefined || quality.systemCpuAvgPct === null
            ? ''
            : ` · всё ${formatPercent(quality.systemCpuAvgPct)}`
        }`
      );
    }
  }
  return parts.join(' · ');
}
</script>

<template>
  <Panel id="feedback" title="Отзывы после звонка" flush>
    <template #aside>
      <Pill v-if="bad" tone="danger" compact
        >{{ formatCount(bad) }} {{ plural(bad, ['плохой', 'плохих', 'плохих']) }}</Pill
      >
    </template>
    <EmptyState v-if="!entries.length" compact title="Отзывов нет" />
    <article v-for="entry in entries" :key="entry.id" class="admin-call-answer">
      <div class="admin-call-answer__head">
        <span
          class="admin-call-answer__rating"
          :class="entry.rating === 'good' ? 'admin-tone--success' : 'admin-tone--danger'"
        >
          <ThumbsUp v-if="entry.rating === 'good'" aria-label="Хорошо" />
          <ThumbsDown v-else aria-label="Плохо" />
        </span>
        <span>{{ entry.author ? entry.author.displayName || entry.author.login : 'Гость' }}</span>
        <span class="admin-call-answer__at admin-rooms-mono">{{ formatClock(entry.createdAt) }}</span>
      </div>
      <div v-if="entry.tags.length" class="admin-call-answer__tags">
        <Pill v-for="tag in entry.tags" :key="tag" compact>{{ CALL_FEEDBACK_TAG_LABELS[tag] }}</Pill>
      </div>
      <p v-if="entry.comment" class="admin-call-answer__comment">«{{ entry.comment }}»</p>
      <p class="admin-call__note">{{ feedbackLine(entry) }}</p>
    </article>
  </Panel>
</template>
