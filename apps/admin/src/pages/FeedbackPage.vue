<script setup lang="ts">
import { ThumbsDown, ThumbsUp } from '@lucide/vue';
import { computed, ref } from 'vue';
import {
  ADMIN_CALL_FEEDBACK_LIMIT,
  ADMIN_CALL_FEEDBACK_PERIODS,
  CALL_FEEDBACK_BAD_TAGS,
  CALL_FEEDBACK_GOOD_TAGS,
  type AdminCallFeedbackEntry,
  type AdminCallFeedbackQuery
} from '@voiceroom/shared/contracts/feedback';
import { CALL_FEEDBACK_TAG_LABELS } from '@voiceroom/shared/feedback-labels';
import { fetchCallFeedback } from '../api/admin.ts';
import { formatCount, formatDateTime, formatMinutes, formatPercent } from '../format.ts';
import Notice from '../Notice.vue';
import { Callout, EmptyState, Panel, Pill, SegmentControl } from '../ui';
import { useAdminResource } from '../use-admin-resource.ts';
import FeedbackQuality from './feedback/FeedbackQuality.vue';
import FeedbackTags from './feedback/FeedbackTags.vue';
import NetworkSpan from './rooms/NetworkSpan.vue';
import Origin from './rooms/Origin.vue';
import { describeNetwork } from './rooms/network-bar.ts';

type Period = (typeof ADMIN_CALL_FEEDBACK_PERIODS)[number];
type RatingFilter = 'all' | 'good' | 'bad';

const PERIOD_LABELS: Record<Period, string> = { '7': '7 дней', '30': '30 дней', '90': '90 дней', '365': 'Год' };
const RATING_OPTIONS: { value: RatingFilter; label: string }[] = [
  { value: 'all', label: 'Все' },
  { value: 'good', label: 'Хорошие' },
  { value: 'bad', label: 'Плохие' }
];
const PLATFORM_LABELS: Record<AdminCallFeedbackEntry['platform'], string> = {
  browser: 'браузер',
  desktop_app: 'приложение',
  mobile: 'телефон'
};
const periods = ADMIN_CALL_FEEDBACK_PERIODS.map((value) => ({ value, label: PERIOD_LABELS[value] }));
const period = ref<Period>('30');
const rating = ref<RatingFilter>('all');
const {
  data: page,
  failure,
  busy: loading,
  reload
} = useAdminResource(
  () => {
    const query: AdminCallFeedbackQuery = {
      days: period.value,
      ...(rating.value === 'all' ? {} : { rating: rating.value })
    };
    return fetchCallFeedback(query);
  },
  [period, rating],
  { failureText: 'Не удалось загрузить отзывы' }
);
const summary = computed(() => page.value?.summary ?? null);
const total = computed(() => (summary.value ? summary.value.good + summary.value.bad : 0));
const goodShare = computed(() => (summary.value && total.value ? (summary.value.good / total.value) * 100 : null));
</script>

<template>
  <div class="admin-metric-toolbar">
    <SegmentControl :options="periods" :value="period" v-bind="{ ariaLabel: 'Период' }" @change="period = $event" />
    <SegmentControl
      :options="RATING_OPTIONS"
      :value="rating"
      v-bind="{ ariaLabel: 'Оценка' }"
      @change="rating = $event"
    />
  </div>
  <Notice v-if="failure && !page" :failure="failure" @retry="reload" />
  <p v-else-if="!page || !summary" class="admin-metric-note" aria-busy="true">Загружаем…</p>
  <template v-else>
    <Callout v-if="failure" tone="danger" :title="failure.message" role="alert" />
    <div class="admin-feedback__cards" :aria-busy="loading">
      <Panel title="Довольны звонком">
        <div class="admin-feedback__score">
          <span class="admin-feedback__score-value">{{ formatPercent(goodShare) }}</span>
          <span class="admin-metric-note">из {{ formatCount(total) }} ответов</span>
        </div>
        <span class="admin-feedback__split" aria-hidden="true">
          <span :style="{ width: `${goodShare ?? 0}%` }" />
        </span>
        <div class="admin-feedback__counts">
          <span class="admin-feedback__count admin-tone--success"
            ><ThumbsUp aria-hidden="true" /> Хорошо <strong>{{ formatCount(summary.good) }}</strong></span
          >
          <span class="admin-feedback__count admin-tone--danger"
            ><ThumbsDown aria-hidden="true" /> Плохо <strong>{{ formatCount(summary.bad) }}</strong></span
          >
        </div>
      </Panel>
      <FeedbackTags
        title="Что мешало"
        :tags="CALL_FEEDBACK_BAD_TAGS"
        :total="summary.bad"
        tone="danger"
        :summary="summary"
      />
      <FeedbackTags
        title="Что понравилось"
        :tags="CALL_FEEDBACK_GOOD_TAGS"
        :total="summary.good"
        tone="success"
        :summary="summary"
      />
    </div>

    <Panel title="Ответы" flush>
      <EmptyState v-if="page.entries.length === 0" title="За этот период ответов нет" compact />
      <div v-else class="admin-feedback__scroll" role="region" aria-label="Таблица ответов" tabindex="0">
        <table class="admin-feedback__table" aria-label="Ответы">
          <thead>
            <tr>
              <th scope="col">Оценка</th>
              <th scope="col">Кто</th>
              <th scope="col">Звонок</th>
              <th scope="col">Связь</th>
              <th scope="col">Отзыв</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="entry in page.entries" :key="entry.id">
              <td>
                <Pill v-if="entry.rating === 'good'" tone="success" compact
                  ><ThumbsUp aria-hidden="true" /> Хорошо</Pill
                >
                <Pill v-else tone="danger" compact><ThumbsDown aria-hidden="true" /> Плохо</Pill>
              </td>
              <td>
                <span class="admin-feedback__who">
                  <span v-if="entry.author"
                    >{{ entry.author.displayName }} ·
                    <span class="admin-metric-mono">@{{ entry.author.login }}</span></span
                  >
                  <span v-else class="admin-feedback__guest"
                    >{{ entry.stay?.guestName ?? 'Гость' }} <Pill compact>гость</Pill></span
                  >
                  <small>{{ formatDateTime(entry.createdAt) }}</small>
                  <Origin v-if="entry.stay" :seat="entry.stay" />
                </span>
              </td>
              <td>
                <span class="admin-feedback__who">
                  <span>{{ entry.roomName ? `«${entry.roomName}»` : 'временная комната' }}</span>
                  <small
                    >{{ formatMinutes(entry.durationS / 60) }} · собеседников {{ entry.peers }} ·
                    {{ PLATFORM_LABELS[entry.platform] }}</small
                  >
                </span>
              </td>
              <td>
                <span class="admin-feedback__network">
                  <FeedbackQuality v-if="entry.quality" :quality="entry.quality" />
                  <span v-else class="admin-metric-note">—</span>
                  <span
                    v-if="entry.stay"
                    class="admin-feedback__network-bar"
                    role="img"
                    :aria-label="describeNetwork({ from: entry.stay.joinedAt, to: entry.stay.leftAt }, entry.stay)"
                  >
                    <NetworkSpan :from="entry.stay.joinedAt" :to="entry.stay.leftAt" :voice="entry.stay" />
                  </span>
                </span>
              </td>
              <td>
                <span class="admin-feedback__review">
                  <span v-if="entry.tags.length" class="admin-feedback__review-tags">
                    <Pill v-for="tag in entry.tags" :key="tag" compact>{{ CALL_FEEDBACK_TAG_LABELS[tag] }}</Pill>
                  </span>
                  <span v-if="entry.comment" class="admin-feedback__comment">{{ entry.comment }}</span>
                </span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-if="page.entries.length >= ADMIN_CALL_FEEDBACK_LIMIT" class="admin-feedback__foot admin-metric-note">
        Показаны последние {{ ADMIN_CALL_FEEDBACK_LIMIT }} ответов за период.
      </p>
    </Panel>
  </template>
</template>
