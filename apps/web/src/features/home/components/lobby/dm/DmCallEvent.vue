<script setup lang="ts">
import { computed } from 'vue';
import { CallEventRow, type CallEventAction, type CallEventKind } from '@voiceroom/ui-kit/components';
import type { DirectMessageCall } from '@voiceroom/shared/contracts/rings';
import { clockTime } from '@/shared/utils/date-format';
import { useFriendCallStore } from '@/features/friend-call/friend-call.store';

const { projection, fromMe, peerId, peerName, createdAt } = defineProps<{
  projection: DirectMessageCall;
  fromMe: boolean;
  peerId: string;
  peerName: string;
  createdAt: number;
}>();
const calls = useFriendCallStore();
const kind = computed<CallEventKind>(() => {
  switch (projection.outcome) {
    case 'live':
      return !fromMe && projection.missedAt !== null ? 'missed' : 'live';
    case 'completed':
      return fromMe ? 'outgoing' : 'incoming';
    case 'declined':
      return 'declined';
    case 'cancelled':
    case 'no_answer':
      return fromMe ? 'no-answer' : 'missed';
  }
});
const record = computed(() => calls.record(projection.callId));
const call = computed(() => record.value?.call);
const joined = computed(() => calls.voice?.callId === projection.callId);
const peerInCall = computed(() =>
  call.value?.seats?.some((seat) => seat.userId === peerId && seat.status !== 'absent')
);
const start = computed(() => (projection.firstConnectedAt ?? projection.startedAt) + (record.value?.offset ?? 0));
const joinAction = computed(() => {
  const current = call.value;
  if (!current || current.phase === 'closed') return undefined;
  if (current.allowedActions.includes('accept')) return 'accept';
  if (current.phase !== 'ringing' && current.allowedActions.some((action) => action === 'join' || action === 'leave'))
    return 'join';
  return undefined;
});
const showAction = computed(
  () => joined.value || (calls.enabled && (kind.value === 'missed' || Boolean(joinAction.value)))
);

function act(action: CallEventAction): void {
  if (action === 'return') calls.open();
  else if (action === 'callback') void calls.dial(peerId);
  else if (call.value && joinAction.value) void calls.act(call.value, joinAction.value);
}
</script>

<template>
  <CallEventRow
    :kind="kind"
    :direction="fromMe ? 'outgoing' : 'incoming'"
    :time="clockTime(createdAt)"
    :date-time="new Date(createdAt).toISOString()"
    :started-at="start"
    :duration-ms="projection.durationMs"
    :peer-name="peerInCall ? peerName : ''"
    :joined="joined"
    :show-action="showAction"
    @action="act"
  />
</template>
