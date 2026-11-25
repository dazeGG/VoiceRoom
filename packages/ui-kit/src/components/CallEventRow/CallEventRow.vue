<script setup lang="ts">
import { Phone, PhoneCall, PhoneIncoming, PhoneMissed, PhoneOff, PhoneOutgoing } from '@lucide/vue';
import { computed } from 'vue';
import { t } from '../../i18n';
import Badge from '../Badge/Badge.vue';
import Button from '../Button/Button.vue';
import Card from '../Card/Card.vue';
import { formatCallClock, useCallClock } from '../call-clock';
import type { CallEventAction, CallEventRowProps } from './types';

const props = withDefaults(defineProps<CallEventRowProps>(), { direction: 'outgoing', showAction: true });
const emit = defineEmits<{ action: [action: CallEventAction] }>();

const icons = {
  outgoing: PhoneOutgoing,
  incoming: PhoneIncoming,
  missed: PhoneMissed,
  'no-answer': PhoneOutgoing,
  declined: PhoneOff,
  live: PhoneCall
};
const titles = {
  outgoing: 'Исходящий звонок',
  incoming: 'Входящий звонок',
  missed: 'Пропущенный звонок',
  'no-answer': 'Нет ответа',
  declined: 'Звонок отклонён',
  live: 'Идёт звонок'
};
const actions = {
  callback: { label: 'Перезвонить', variant: 'ghost' },
  join: { label: 'Присоединиться', variant: 'primary' },
  return: { label: 'Вернуться в звонок', variant: 'soft' }
} as const;

const elapsed = useCallClock(() => (props.kind === 'live' ? props.startedAt : undefined), 'since');
const timer = computed(() => formatCallClock(Math.floor(elapsed.value / 1000), true));
const duration = computed(() => {
  if (props.kind !== 'outgoing' && props.kind !== 'incoming') return;
  if (props.durationMs === undefined) return;
  const minutes = Math.floor(props.durationMs / 60_000);
  if (minutes < 1) return t('меньше минуты');
  if (minutes < 60) return t('{minutes} мин', { minutes });
  return t('{hours} ч {minutes} мин', {
    hours: Math.floor(minutes / 60),
    minutes: String(minutes % 60).padStart(2, '0')
  });
});
const directionLabel = computed(() => {
  if (props.kind !== 'no-answer' && props.kind !== 'declined') return;
  return props.direction === 'incoming' ? t('Входящий') : t('Исходящий');
});
const liveLabel = computed(() => {
  if (props.joined) return t('Вы в звонке');
  return props.peerName ? t('{name} в звонке', { name: props.peerName }) : undefined;
});
const action = computed<CallEventAction | undefined>(() => {
  if (!props.showAction) return;
  if (props.kind === 'missed') return 'callback';
  if (props.kind !== 'live') return undefined;
  return props.joined ? 'return' : 'join';
});
</script>

<template>
  <Card as="article" :class="['ui-call-event-row', `ui-call-event-row--${kind}`]">
    <span class="ui-call-event-row__icon" aria-hidden="true"><component :is="icons[kind]" /></span>
    <div class="ui-call-event-row__body">
      <p class="ui-call-event-row__title">
        {{ t(titles[kind]) }}
        <span v-if="kind === 'live'" class="ui-call-event-row__duration">
          · <span class="ui-call-event-row__clock" role="timer" aria-live="off">{{ timer }}</span>
        </span>
        <span v-else-if="duration" class="ui-call-event-row__duration">· {{ duration }}</span>
      </p>
      <p v-if="kind === 'live' && liveLabel" class="ui-call-event-row__meta">
        <Badge variant="dot" tone="online" />{{ liveLabel }}
      </p>
      <p v-else-if="kind !== 'live' && (directionLabel || time)" class="ui-call-event-row__meta">
        <span v-if="directionLabel">{{ directionLabel }}</span>
        <span v-if="directionLabel && time" aria-hidden="true">·</span>
        <time v-if="time" :datetime="dateTime">{{ time }}</time>
      </p>
    </div>
    <Button v-if="action" size="sm" :variant="actions[action].variant" wrap @click="emit('action', action)">
      <template v-if="action !== 'return'" #icon><Phone aria-hidden="true" /></template>
      {{ t(actions[action].label) }}
    </Button>
  </Card>
</template>
