<script setup lang="ts">
import { BellOff, LogOut, Phone, PhoneOff } from '@lucide/vue';
import { computed, useId } from 'vue';
import { t } from '../../i18n';
import Avatar from '../Avatar/Avatar.vue';
import Button from '../Button/Button.vue';
import Card from '../Card/Card.vue';
import IconButton from '../IconButton/IconButton.vue';
import Progress from '../Progress/Progress.vue';
import Spinner from '../Spinner/Spinner.vue';
import { useCallClock } from '../call-clock';
import type { IncomingCallCardProps } from './types';

const props = withDefaults(defineProps<IncomingCallCardProps>(), { variant: 'default', state: 'ringing' });
const emit = defineEmits<{ accept: []; decline: []; toggleSilence: [] }>();
const ringWindowMs = 45_000;

const titleId = useId();
const noteId = useId();
const accepting = computed(() => props.state === 'accepting');
const remaining = useCallClock(() => props.expiresAt, 'until');
const expired = computed(() => remaining.value === 0);
const unavailable = computed(() => expired.value || accepting.value);
const halo = computed(() => {
  if (expired.value) return undefined;
  return props.silenced || accepting.value || props.variant === 'compact' ? 'silenced' : 'ringing';
});

function act(action: () => void): void {
  if (unavailable.value || Date.now() >= props.expiresAt) return;
  action();
}
</script>

<template>
  <Card
    as="section"
    :aria-labelledby="titleId"
    :class="['ui-incoming-call-card', { 'ui-incoming-call-card--compact': variant === 'compact' }]"
  >
    <div class="ui-incoming-call-card__caller">
      <Avatar v-bind="caller" :size="variant === 'compact' ? 32 : 48" :ringing="halo" />
      <div class="ui-incoming-call-card__copy">
        <span v-if="variant === 'default'" class="ui-incoming-call-card__caption">{{
          silenced ? t('Звук звонка выключен') : t('Входящий звонок')
        }}</span>
        <p :id="titleId" class="ui-incoming-call-card__title">{{ t('{name} звонит вам', { name: caller.name }) }}</p>
        <span v-if="variant === 'compact'" class="ui-incoming-call-card__caption">{{ t('Ещё один входящий') }}</span>
      </div>
      <IconButton
        v-if="variant === 'default'"
        :label="silenced ? t('Включить звук звонка') : t('Выключить звук звонка')"
        :aria-pressed="silenced"
        :disabled="unavailable"
        @click="act(() => emit('toggleSilence'))"
      >
        <BellOff aria-hidden="true" />
      </IconButton>
    </div>

    <div class="ui-incoming-call-card__actions">
      <template v-if="variant === 'compact'">
        <IconButton
          :label="t('Отклонить: {name}', { name: caller.name })"
          variant="danger-solid"
          :tooltip="false"
          :disabled="unavailable"
          @click="act(() => emit('decline'))"
        >
          <PhoneOff aria-hidden="true" />
        </IconButton>
        <IconButton
          :label="accepting ? t('Подключаемся…') : t('Принять: {name}', { name: caller.name })"
          variant="primary"
          :tooltip="false"
          :disabled="unavailable"
          :aria-busy="accepting || undefined"
          :aria-describedby="leaveRoomName ? noteId : undefined"
          @click="act(() => emit('accept'))"
        >
          <Spinner v-if="accepting" aria-hidden="true" />
          <Phone v-else aria-hidden="true" />
        </IconButton>
      </template>
      <template v-else>
        <Button size="lg" variant="danger" :disabled="unavailable" @click="act(() => emit('decline'))">
          <template #icon><PhoneOff aria-hidden="true" /></template>
          {{ t('Отклонить') }}
        </Button>
        <Button
          size="lg"
          variant="primary"
          :busy="accepting"
          :disabled="expired"
          :aria-describedby="leaveRoomName ? noteId : undefined"
          @click="act(() => emit('accept'))"
        >
          <template #icon><Phone aria-hidden="true" /></template>
          {{ accepting ? t('Подключаемся…') : t('Принять') }}
        </Button>
      </template>
    </div>
    <p v-if="leaveRoomName" :id="noteId" class="ui-incoming-call-card__note">
      <LogOut aria-hidden="true" />
      <span>{{ t('Вы покинете «{room}»', { room: leaveRoomName }) }}</span>
    </p>
    <Progress
      v-if="!accepting"
      class="ui-incoming-call-card__expiry"
      variant="track"
      label=""
      :value="(remaining / ringWindowMs) * 100"
    />
  </Card>
</template>
