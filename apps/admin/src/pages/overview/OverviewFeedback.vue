<script setup lang="ts">
import { computed } from 'vue';
import type { AdminOverview } from '@voice-room/shared/contracts/admin';
import { formatCount } from '../../format.ts';
import { Card, EmptyState } from '../../ui';
import { badFeedbackTags, tagLabel } from './overview-details.ts';

const props = defineProps<{ feedback: NonNullable<AdminOverview['feedback']> }>();
const total = computed(() => props.feedback.week.good + props.feedback.week.bad);
const tags = computed(() => badFeedbackTags(props.feedback.week.tags).slice(0, 4));
const largest = computed(() => tags.value[0]?.count || 1);
</script>

<template>
  <Card v-if="total" class="admin-overview-feedback">
    <div class="admin-overview-feedback__summary">
      <strong class="admin-overview-feedback__share">{{ Math.round((feedback.week.good / total) * 100) }} %</strong>
      <span class="admin-metric-note">
        хороших ·
        <span class="admin-overview-feedback__count admin-tone--success">{{ formatCount(feedback.week.good) }}</span>
        хорошо,
        <span class="admin-overview-feedback__count admin-tone--danger">{{ formatCount(feedback.week.bad) }}</span>
        плохо
      </span>
    </div>
    <span
      class="admin-overview-feedback__bar"
      role="img"
      :aria-label="`${formatCount(feedback.week.good)} хороших и ${formatCount(feedback.week.bad)} плохих отзывов`"
    >
      <span
        v-if="feedback.week.good"
        class="admin-overview-feedback__bar-fill admin-tone--success"
        :style="{ flexGrow: feedback.week.good }"
      />
      <span
        v-if="feedback.week.bad"
        class="admin-overview-feedback__bar-fill admin-tone--danger"
        :style="{ flexGrow: feedback.week.bad }"
      />
    </span>
    <template v-if="tags.length">
      <span class="admin-metric-note">Чаще всего в плохих</span>
      <div v-for="{ tag, count } in tags" :key="tag" class="admin-overview-feedback__tag">
        <span>{{ tagLabel(tag) }}</span>
        <span class="admin-overview-feedback__bar" aria-hidden="true">
          <span
            class="admin-overview-feedback__bar-fill admin-tone--danger"
            :style="{ width: `${(count / largest) * 100}%` }"
          />
        </span>
        <span class="admin-metric-mono">{{ formatCount(count) }}</span>
      </div>
    </template>
  </Card>
  <Card v-else><EmptyState title="За неделю отзывов не было" compact /></Card>
</template>
