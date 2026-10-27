<script setup lang="ts">
// The question about one call: a thumb opens what went well or wrong and a
// comment. Mounted per call, so a new question starts with nothing chosen.
// Inside the prompt's Dialog the window owns the title, the cross and Escape,
// and asks the card to `close()`. `hosted` is the question as the bottom of the
// leave screen: that window has its own ways out, so the question has no cross,
// no Escape and does not go away by itself.
import { ThumbsDown, ThumbsUp } from '@lucide/vue';
import { computed, ref, watchEffect } from 'vue';
import { CALL_FEEDBACK_COMMENT_MAX_LENGTH, CALL_FEEDBACK_TAGS_BY_RATING } from '@voice-room/shared/contracts/feedback';
import { CALL_FEEDBACK_TAG_LABELS } from '@voice-room/shared/feedback-labels';
import type { CallFeedbackCall, CallFeedbackRating, CallFeedbackTag } from '@/api/feedback';
import { Button } from '@/shared/ui/Button';
import { iconMd } from '@/shared/ui/icons';
import { useCallFeedbackStore } from './call-feedback.store';

const props = withDefaults(defineProps<{ call: CallFeedbackCall; hosted?: boolean }>(), { hosted: false });

const emit = defineEmits<{ answered: [] }>();

/** How long an untouched question stays on a page someone is looking at. */
const UNANSWERED_CLOSE_MS = 60_000;

const feedback = useCallFeedbackStore();

const rating = ref<CallFeedbackRating | null>(null);
const tags = ref<CallFeedbackTag[]>([]);
const comment = ref('');

const minutes = computed(() => Math.max(1, Math.round(props.call.durationS / 60)));

// Untouched, the question goes away by itself, but only counting the time
// the page is in view, and without counting as a skip: it may go unseen.
watchEffect((onCleanup) => {
  if (rating.value || props.hosted) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const arm = () => {
    clearTimeout(timer);
    if (document.visibilityState === 'visible') timer = setTimeout(feedback.dropCallFeedback, UNANSWERED_CLOSE_MS);
  };
  arm();
  document.addEventListener('visibilitychange', arm);
  onCleanup(() => {
    clearTimeout(timer);
    document.removeEventListener('visibilitychange', arm);
  });
});

function choose(next: CallFeedbackRating): void {
  if (rating.value !== next) tags.value = [];
  rating.value = next;
}

function toggle(tag: CallFeedbackTag): void {
  tags.value = tags.value.includes(tag) ? tags.value.filter((other) => other !== tag) : [...tags.value, tag];
}

function send(): void {
  if (!rating.value) return;
  void feedback.answerCallFeedback({ rating: rating.value, tags: tags.value, comment: comment.value });
  emit('answered');
}

// A chosen thumb is already an answer: closing sends what is there.
function close(): void {
  if (rating.value) send();
  else feedback.skipCallFeedback();
}

defineExpose({ close });
</script>

<template>
  <div class="call-feedback">
    <div class="call-feedback__head">
      <div>
        <h2 v-if="hosted" id="callFeedbackTitle" class="call-feedback__title">Как прошёл звонок?</h2>
        <p class="call-feedback__sub">Звонок длился {{ minutes }} мин</p>
      </div>
    </div>

    <div class="call-feedback__thumbs">
      <button
        class="call-feedback__thumb call-feedback__thumb--good"
        type="button"
        aria-label="Хорошо"
        :aria-pressed="rating === 'good'"
        @click="choose('good')"
      >
        <ThumbsUp v-bind="iconMd" aria-hidden="true" />
      </button>
      <button
        class="call-feedback__thumb call-feedback__thumb--bad"
        type="button"
        aria-label="Плохо"
        :aria-pressed="rating === 'bad'"
        @click="choose('bad')"
      >
        <ThumbsDown v-bind="iconMd" aria-hidden="true" />
      </button>
    </div>

    <form v-if="rating" class="call-feedback__details" @submit.prevent="send">
      <fieldset class="call-feedback__tags">
        <legend>{{ rating === 'good' ? 'Что понравилось?' : 'Что пошло не так?' }}</legend>
        <button
          v-for="tag in CALL_FEEDBACK_TAGS_BY_RATING[rating]"
          :key="tag"
          class="call-feedback__tag"
          type="button"
          :aria-pressed="tags.includes(tag)"
          @click="toggle(tag)"
        >
          {{ CALL_FEEDBACK_TAG_LABELS[tag] }}
        </button>
      </fieldset>
      <textarea
        v-model="comment"
        class="call-feedback__comment"
        aria-label="Комментарий"
        rows="2"
        :maxlength="CALL_FEEDBACK_COMMENT_MAX_LENGTH"
        :placeholder="rating === 'good' ? 'Что ещё улучшить?' : 'Что случилось? Расскажите подробнее'"
      ></textarea>
      <div class="call-feedback__actions">
        <Button variant="primary" type="submit">Отправить</Button>
      </div>
    </form>
  </div>
</template>
