import { defineStore } from 'pinia';
import { computed, reactive, ref, shallowRef } from 'vue';
import type { CallActionBody, CallAnswer, CallIncoming, CallSnapshot } from '@voiceroom/shared/contracts/rings';
import { actOnCallRing, fetchCallRing, fetchCallRings, startCallRing } from '@/api/call-rings';
import { ApiError } from '@/api/client';
import { subscribeCallAccountEvents } from '@/entities/room/room-realtime';
import { t } from '@/shared/i18n';
import { newId } from '@/shared/new-id';
import { readStorage, writeStorage } from '@/shared/storage';
import { useToastsStore } from '@/features/home/model/toasts.store';

type Action = CallActionBody['action'];
type Admission = NonNullable<CallAnswer['voiceAdmission']>;
type CallRecord = { call: CallSnapshot; offset: number };
type IncomingAttempt = CallIncoming & { expiresAt: number };
type Navigation = {
  prepareVoice(): Promise<void>;
  openCall(callId: string): void;
  closeCall(callId: string, peerId: string): void;
};
const RINGER_MUTED_KEY = 'voice-room:incoming-call-muted';
export const incomingAttemptKey = ({ callId, attempt }: CallIncoming) => `${callId}:${attempt}`;

export const callPeer = (call: CallSnapshot, userId: string) =>
  call.caller.id === userId ? call.recipient : call.caller;

export const useFriendCallStore = defineStore('friend-call', () => {
  const enabled = ref(false);
  const userId = ref('');
  const records = reactive(new Map<string, CallRecord>());
  const attempts = reactive(new Map<string, IncomingAttempt>());
  const voice = shallowRef<(Admission & { callId: string }) | null>(null);
  const busy = shallowRef<{ action: Action | 'start'; id: string } | null>(null);
  const mutedAttempt = ref<string | null>(null);
  const closingCallId = ref('');
  const toasts = useToastsStore();
  const fences = new Map<string, number>();
  const expiredAttempts = new Map<string, number>();
  const timers = new Map<string, { deadline: number; handle: ReturnType<typeof setTimeout> }>();
  let closeTimer: ReturnType<typeof setTimeout> | undefined;
  let unsubscribe: (() => void) | undefined;
  let navigation: Navigation | undefined;
  let session = 0;
  let resync = 0;
  let startRetry: { peerId: string; requestId: string } | undefined;
  const updateSilence = () => {
    mutedAttempt.value = readStorage(RINGER_MUTED_KEY);
  };
  const onStorage = (event: StorageEvent) => {
    if (event.key === RINGER_MUTED_KEY || event.key === null) updateSilence();
  };

  const incoming = computed(() =>
    enabled.value ? [...attempts.values()].sort((a, b) => a.ringingExpiresAt - b.ringingExpiresAt) : []
  );

  function callForPeer(peerId: string): CallSnapshot | undefined {
    return [...records.values()].find(
      ({ call }) => call.phase !== 'closed' && callPeer(call, userId.value).id === peerId
    )?.call;
  }

  function syncDeadline(callId: string): void {
    const record = records.get(callId);
    const call = record?.call;
    const attempt = attempts.get(callId);
    const now = Date.now();
    const serverDeadline = call?.phase === 'ringing' ? call.ringingExpiresAt : call?.aloneDeadline;
    const callDeadline = record && serverDeadline != null ? serverDeadline + record.offset : 0;
    const deadline = Math.min(attempt?.expiresAt ?? Infinity, callDeadline > now ? callDeadline : Infinity);
    const previous = timers.get(callId);
    if (previous?.deadline === deadline) return;
    if (previous) clearTimeout(previous.handle);
    timers.delete(callId);
    if (!Number.isFinite(deadline)) return;
    const epoch = session;
    const handle = setTimeout(
      () => {
        timers.delete(callId);
        const current = attempts.get(callId);
        if (current && current.expiresAt <= Date.now()) {
          attempts.delete(callId);
          expiredAttempts.set(callId, current.attempt);
        }
        void refreshCall(callId, epoch, true);
      },
      Math.max(0, deadline - now)
    );
    timers.set(callId, { deadline, handle });
  }

  function applyIncoming(event: CallIncoming): void {
    const { callId, revision, attempt } = event;
    const previous = attempts.get(callId);
    const current = records.get(callId)?.call;
    if (attempt <= (expiredAttempts.get(callId) ?? 0)) return;
    if (revision <= (fences.get(callId) ?? 0) || revision <= (previous?.revision ?? 0)) return;
    if (
      current &&
      (revision < current.revision ||
        (revision === current.revision && (!current.allowedActions.includes('accept') || current.attempt !== attempt)))
    )
      return;
    const expiresAt =
      previous?.attempt === attempt ? previous.expiresAt : Date.now() + (event.ringingExpiresAt - event.serverNow);
    if (expiresAt <= Date.now()) return;
    attempts.set(callId, { ...event, expiresAt });
    syncDeadline(callId);
  }

  function applyCall(call: CallSnapshot): void {
    const { id, revision } = call;
    if (call.caller.id !== userId.value && call.recipient.id !== userId.value) return;
    const previous = records.get(id);
    const attempt = attempts.get(id);
    if (revision <= (previous?.call.revision ?? 0) || revision <= (fences.get(id) ?? 0)) return;
    if (attempt && revision < attempt.revision) return;
    const offset = previous?.offset ?? Date.now() - call.serverNow;
    records.set(id, { call, offset });
    if (call.allowedActions.includes('accept')) {
      applyIncoming({
        callId: id,
        fromUser: callPeer(call, userId.value),
        attempt: call.attempt,
        revision,
        ringingExpiresAt: call.ringingExpiresAt,
        serverNow: Date.now() - offset
      });
    } else attempts.delete(id);
    syncDeadline(id);

    if (call.phase === 'closed') {
      const heldVoice = voice.value?.callId === id;
      if (heldVoice) voice.value = null;
      if (heldVoice && call.endReason === 'alone_timeout') {
        toasts.pushToast(t('Звонок завершён'), { description: t('Вы были одни в звонке 5 минут') });
      }
      const peerId = callPeer(call, userId.value).id;
      if (call.endReason === 'declined' && call.endedByUserId !== userId.value && heldVoice) {
        clearTimeout(closeTimer);
        closingCallId.value = id;
        closeTimer = setTimeout(() => {
          closingCallId.value = '';
          navigation?.closeCall(id, peerId);
        }, 2_000);
      } else navigation?.closeCall(id, peerId);
      return;
    }
    // The seat can leave or be transferred while this tab was disconnected.
    const wasPresent = previous?.call.seats?.some((seat) => seat.userId === userId.value && seat.status !== 'absent');
    const nowAbsent = call.seats?.some((seat) => seat.userId === userId.value && seat.status === 'absent');
    if (wasPresent && nowAbsent && voice.value?.callId === id) {
      voice.value = null;
      navigation?.closeCall(id, callPeer(call, userId.value).id);
    }
  }

  async function refreshCall(id: string, epoch: number, missingCloses = false): Promise<void> {
    const before = records.get(id);
    try {
      const { call } = await fetchCallRing(id);
      if (epoch === session) applyCall(call);
    } catch (error) {
      if (epoch === session && missingCloses && error instanceof ApiError && error.code === 'call_not_found') {
        if (!before || records.get(id) !== before) return;
        records.delete(id);
        fences.set(id, before.call.revision);
        if (voice.value?.callId === id) voice.value = null;
        navigation?.closeCall(id, callPeer(before.call, userId.value).id);
      }
    }
  }

  async function reconcile(): Promise<void> {
    const epoch = session;
    const request = ++resync;
    const oldRecords = [...records];
    const oldAttempts = [...attempts];
    try {
      const result = await fetchCallRings();
      if (epoch !== session || request !== resync) return;
      enabled.value = result.enabled;
      const activeIds = new Set(result.activeCalls.map((call) => call.id));
      const incomingIds = new Set(result.incoming.map((event) => event.callId));
      for (const call of result.activeCalls) applyCall(call);
      for (const event of result.incoming) applyIncoming(event);
      for (const [id, previous] of oldAttempts) {
        if (attempts.get(id) !== previous || incomingIds.has(id) || previous.serverNow > result.serverNow) continue;
        attempts.delete(id);
        expiredAttempts.set(id, previous.attempt);
        fences.set(id, Math.max(fences.get(id) ?? 0, previous.revision));
        syncDeadline(id);
      }
      for (const [id, previous] of oldRecords) {
        if (activeIds.has(id) || records.get(id) !== previous || previous.call.phase === 'closed') continue;
        if (previous.call.serverNow > result.serverNow) continue;
        void refreshCall(id, epoch, true);
      }
    } catch (error) {
      if (epoch === session && request === resync && error instanceof ApiError && error.status === 404) {
        enabled.value = false;
      }
    }
  }

  function reset(): void {
    session += 1;
    unsubscribe?.();
    unsubscribe = undefined;
    window.removeEventListener('storage', onStorage);
    navigation = undefined;
    userId.value = '';
    enabled.value = false;
    busy.value = null;
    voice.value = null;
    closingCallId.value = '';
    startRetry = undefined;
    records.clear();
    attempts.clear();
    fences.clear();
    expiredAttempts.clear();
    for (const { handle } of timers.values()) clearTimeout(handle);
    timers.clear();
    clearTimeout(closeTimer);
  }

  function startSession(id: string, hooks: Navigation): () => void {
    reset();
    userId.value = id;
    navigation = hooks;
    updateSilence();
    window.addEventListener('storage', onStorage);
    const epoch = session;
    unsubscribe = subscribeCallAccountEvents(id, {
      ready: () => void reconcile(),
      state: applyCall,
      incoming: applyIncoming
    });
    void reconcile();
    return () => {
      if (epoch === session) reset();
    };
  }

  function reportError(error: unknown, retry: () => Promise<void>): void {
    const networkFailure = !(error instanceof ApiError) || error.status === 0 || error.status >= 500;
    toasts.pushToast(t('Не удалось позвонить'), {
      variant: 'error',
      description: networkFailure ? t('Проверьте подключение и попробуйте ещё раз') : error.message,
      actions: [
        {
          label: t('Повторить'),
          onClick: (toastId) => {
            toasts.dismissToast(toastId);
            void retry();
          }
        }
      ]
    });
  }

  async function run(action: Action | 'start', id: string, request: () => Promise<void>): Promise<void> {
    if (busy.value || !userId.value) return;
    const epoch = session;
    busy.value = { action, id };
    try {
      await request();
    } catch (error) {
      if (epoch === session)
        reportError(error, async () => {
          if (epoch === session) await run(action, id, request);
        });
    } finally {
      if (epoch === session) busy.value = null;
    }
  }

  async function depart(): Promise<void> {
    const seat = voice.value;
    if (!seat) return;
    const record = records.get(seat.callId);
    voice.value = null;
    if (!record || record.call.phase === 'closed') return;
    const { call } = record;
    const epoch = session;
    navigation?.closeCall(call.id, callPeer(call, userId.value).id);
    const result = await actOnCallRing(call.id, {
      action: 'leave',
      clientRequestId: newId(),
      expectedAttempt: call.attempt,
      expectedRevision: call.revision,
      seatToken: seat.seatToken
    });
    if (epoch === session) applyCall(result.call);
  }

  async function openAnswer(answer: CallAnswer, epoch: number): Promise<void> {
    if (epoch !== session) return;
    applyCall(answer.call);
    const { id } = answer.call;
    const current = records.get(id)?.call;
    if (!current || current.phase === 'closed') return;
    if (answer.voiceAdmission && voice.value?.callId !== id) {
      await navigation?.prepareVoice();
      if (epoch !== session || records.get(id)?.call.phase === 'closed') return;
      voice.value = { callId: id, ...answer.voiceAdmission };
    }
    if (voice.value?.callId === id) navigation?.openCall(id);
  }

  async function dial(peerId: string): Promise<void> {
    if (!enabled.value || peerId === userId.value) return;
    const existing = callForPeer(peerId);
    if (existing && voice.value?.callId === existing.id) {
      navigation?.openCall(existing.id);
      return;
    }
    if (existing?.allowedActions.includes('accept')) return act(existing, 'accept');
    if (existing && existing.phase !== 'ringing') return act(existing, 'join');
    await run('start', peerId, async () => {
      const epoch = session;
      if (!enabled.value) return;
      if (voice.value) await depart();
      if (epoch !== session) return;
      const requestId = startRetry?.peerId === peerId ? startRetry.requestId : newId();
      startRetry = { peerId, requestId };
      const result = await startCallRing({ peerUserId: peerId, clientRequestId: requestId });
      if (epoch !== session) return;
      startRetry = undefined;
      await openAnswer(result, epoch);
    });
  }

  function act(target: CallSnapshot | CallIncoming, action: Exclude<Action, 'leave'>): Promise<void> {
    const id = 'id' in target ? target.id : target.callId;
    return run(action, id, async () => {
      const epoch = session;
      const current = records.get(id)?.call;
      const incoming = attempts.get(id);
      const canAnswer = (action === 'accept' || action === 'decline') && incoming?.attempt === target.attempt;
      const transfer =
        action === 'join' && current?.phase !== 'ringing' && current?.allowedActions.includes('leave')
          ? current.revision
          : undefined;
      if (
        !canAnswer &&
        (!current ||
          current.attempt !== target.attempt ||
          (transfer === undefined && !current.allowedActions.includes(action)))
      )
        return;
      if ((action === 'accept' || action === 'join') && voice.value && voice.value.callId !== id) await depart();
      if (epoch !== session) return;
      const result = await actOnCallRing(id, {
        action,
        expectedAttempt: target.attempt,
        clientRequestId: newId(),
        ...(transfer !== undefined && { expectedRevision: transfer })
      });
      if (epoch !== session) return;
      if (action === 'accept' || action === 'join') await openAnswer(result, epoch);
      else applyCall(result.call);
    });
  }

  function leave(): Promise<void> {
    return run('leave', voice.value?.callId ?? '', depart);
  }

  function toggleSilence(attempt: CallIncoming): void {
    const key = incomingAttemptKey(attempt);
    mutedAttempt.value = mutedAttempt.value === key ? null : key;
    writeStorage(RINGER_MUTED_KEY, mutedAttempt.value ?? '');
  }

  return {
    enabled,
    userId,
    voice,
    busy,
    mutedAttempt,
    incoming,
    closingCallId,
    startSession,
    callForPeer,
    record: (id: string) => records.get(id),
    dial,
    act,
    leave,
    toggleSilence
  };
});
