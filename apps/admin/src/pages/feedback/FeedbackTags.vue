<script setup lang="ts">
import { computed } from 'vue';
import type { AdminCallFeedbackPage, CallFeedbackTag } from '@voice-room/shared/contracts/feedback';
import { CALL_FEEDBACK_TAG_LABELS } from '@voice-room/shared/feedback-labels';
import { formatCount, formatPercent } from '../../format.ts';
import { Panel } from '../../ui';

const props = defineProps<{
  title: string;
  tags: readonly CallFeedbackTag[];
  total: number;
  tone: 'danger' | 'success';
  summary: AdminCallFeedbackPage['summary'];
}>();
const rows = computed(() =>
  props.tags
    .map((tag) => {
      const count = props.summary.tags.find((item) => item.tag === tag)?.count ?? 0;
      return { tag, count, share: props.total ? (count / props.total) * 100 : 0 };
    })
    .sort((a, b) => b.count - a.count)
);
</script>

<template>
  <Panel :title="title">
    <ul class="admin-feedback__tags" :class="'admin-tone--' + tone">
      <li v-for="row in rows" :key="row.tag">
        <span class="admin-feedback__tag-line">
          <span>{{ CALL_FEEDBACK_TAG_LABELS[row.tag] }}</span>
          <span class="admin-feedback__tag-count"
            >{{ formatCount(row.count) }} <small>{{ formatPercent(row.share) }}</small></span
          >
        </span>
        <span class="admin-feedback__tag-track" aria-hidden="true">
          <span class="admin-feedback__tag-fill" :style="{ width: `${row.share}%` }" />
        </span>
      </li>
    </ul>
  </Panel>
</template>
