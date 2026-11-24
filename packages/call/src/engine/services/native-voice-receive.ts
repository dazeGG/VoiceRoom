import type { RoomSnapshot, NativeVoiceCompanions } from '@voiceroom/shared/contracts/realtime';
import type { NativeVoiceAdmission } from '@voiceroom/shared/contracts/admission';
import { isLiveKitOnlyIdentity } from '@voiceroom/shared/validation';
import { state } from '../core/room-runtime.store';
import { nativeReceiveRoute } from '../core/native-receive-route';
import {
  getParticipantAudioPreference,
  getParticipantAudioPreferenceKey,
  getStoredMasterVolume
} from '../core/settings';
import { createLogger } from '../diagnostics';
import type { NativeVoiceBridge, NativeVoiceEvent, NativeVoiceStats } from '../desktop-capabilities';
import { getInstalledCallPorts } from '../ports';
import { detachMeter } from '../media/meters';
import { removeAudioElements, setParticipantSpeaking } from '../room/participants';
import { isMicrophonePublication } from './livekit/publication-kinds';
import { syncLiveKitVoiceSubscriptions } from './livekit/remote-participants';
import { setBrowserVoiceHandoffMuted } from './audio-bus';
import { counterGrowth, speechConcealment } from '../media/rtc-stats';

const log = createLogger('room:native-receive');
const TRANSPORT_TIMEOUT_MS = 3001;
const STATS_TIMEOUT_MS = 4001;
const COMMAND_TIMEOUT_MS = 10_000;
const STOP_TIMEOUT_MS = 1_000;
const HANDOFF_TIMEOUT_MS = 1_100;

type Capability = NonNullable<RoomSnapshot['nativeVoice']>;
type Settings = { tracks: string[]; outputDeviceId: string };
type AppliedSettings = Omit<Settings, 'outputDeviceId'> & { outputDeviceId: string | null };
type Timer = ReturnType<typeof setTimeout>;
type TimerKey = 'statsTimer' | 'transportTimer' | 'expiryTimer';

interface VoiceDeltas {
  playedSamples: number;
  concealedSamples: number;
  gaps: number;
  bufferSeconds: number;
  bufferSamples: number;
}

interface ReceiveSession {
  callId: string;
  bridge: NativeVoiceBridge;
  generation: string;
  settings: Settings;
  applied?: AppliedSettings;
  selection?: { id: string; resolved: Promise<string | null | undefined> };
  unsubscribe?: () => void;
  startSent: boolean;
  connected: boolean;
  ready: boolean;
  progressed: boolean;
  phase: 'probe' | 'unmuting' | 'confirming' | 'active';
  requestedMute: boolean;
  unmutePending: boolean;
  updating: boolean;
  dirty: boolean;
  stats?: NativeVoiceStats;
  deltas: VoiceDeltas;
  confirmationTimer?: Timer;
  statsTimer?: Timer;
  transportTimer?: Timer;
  expiryTimer?: Timer;
}

let capability: Capability | undefined;
let companions: ReadonlyMap<string, string> = new Map();
let session: ReceiveSession | undefined;
let restoring: ReceiveSession | undefined;
let fellBack = false;

export function isNativeVoiceReceiving(): boolean {
  return nativeReceiveRoute.active;
}

function emptyVoiceDeltas(): VoiceDeltas {
  return { playedSamples: 0, concealedSamples: 0, gaps: 0, bufferSeconds: 0, bufferSamples: 0 };
}

export function takeNativeVoiceDeltas(): VoiceDeltas | undefined {
  if (session?.phase !== 'active') return undefined;
  const deltas = session.deltas;
  session.deltas = emptyVoiceDeltas();
  return deltas;
}

export function setNativeVoiceCompanions(mapping: NativeVoiceCompanions | undefined): void {
  companions = new Map(mapping?.companions.map(({ identity, peerId }) => [identity, peerId]));
}

export function syncNativeVoiceSpeakers(
  speakers: readonly { identity: string }[] = state.livekitRoom?.activeSpeakers ?? []
): void {
  const activeIds = new Set(speakers.map(({ identity }) => companions.get(identity) ?? identity));
  const muted = outputMuted();
  for (const peer of state.peers.values()) {
    if (peer.isLocal || peer.id === state.peerId) continue;
    setParticipantSpeaking(peer, !peer.muted && !muted && activeIds.has(peer.id));
  }
}

function outputMuted(): boolean {
  return state.outputMuted || state.localAppAudioSuppressed;
}

export function setNativeVoiceCapability(next: Capability | undefined): void {
  capability = next;
  if (session && (next?.stage !== 'receive' || next.generation !== session.generation)) {
    fallback(session, 'admission_revoked');
    return;
  }
  syncNativeVoiceReceive();
}

function readSettings(): Settings | undefined {
  if (getStoredMasterVolume() !== 100) return undefined;
  const tracks: string[] = [];
  for (const [id, peer] of state.peers) {
    if (!id || peer.isLocal || id === state.peerId || isLiveKitOnlyIdentity(id)) continue;
    const { muted, volume } = getParticipantAudioPreference(getParticipantAudioPreferenceKey(peer.accountUserId, id));
    if (volume !== 1) return undefined;
    if (muted || (state.serverPeerSyncReady && !state.serverPeerIds.has(id))) continue;
    const participant = state.livekitRoom?.remoteParticipants.get(id);
    if (!participant || participant !== peer.livekitParticipant) continue;
    for (const publication of participant.trackPublications.values()) {
      if (isMicrophonePublication(publication) && !publication.isMuted) tracks.push(publication.trackSid);
    }
  }
  return {
    tracks: tracks.sort(),
    outputDeviceId: state.outputDeviceId
  };
}

export function syncNativeVoiceReceive({ devicesChanged = false } = {}): void {
  if (fellBack || !state.joined || !state.livekitRoom || capability?.stage !== 'receive') return;
  if (session) {
    syncOutputMute(session);
    if (fellBack) return;
  }
  const ports = getInstalledCallPorts();
  const bridge = ports?.platform.desktop.nativeVoice;
  const admit = ports?.transport.requestNativeVoiceAdmission;
  // Only the eligible main-room owner receives the personal capability. Also
  // require the signed-in renderer and the desktop preload.
  if (!bridge || !admit || ports.identity.current().kind !== 'account') return;
  const settings = readSettings();
  if (!settings) {
    if (session) fallback(session, 'unsupported_volume');
    else noteFallback('unsupported_volume');
    return;
  }
  if (session) {
    const current = session;
    const wasEmpty = current.settings.tracks.length === 0;
    current.settings = settings;
    if (devicesChanged) delete current.selection;
    if (current.startSent && wasEmpty !== (settings.tracks.length === 0)) resetStatsTimer(current);
    if (current.applied) void reconcile(current);
    return;
  }
  const current: ReceiveSession = {
    callId: globalThis.crypto.randomUUID(),
    bridge,
    generation: capability.generation,
    settings,
    startSent: false,
    connected: false,
    ready: false,
    progressed: false,
    phase: 'probe',
    requestedMute: true,
    unmutePending: false,
    updating: false,
    dirty: false,
    deltas: emptyVoiceDeltas()
  };
  session = current;
  nativeReceiveRoute.settingsChanged = syncNativeVoiceReceive;
  const { roomId, peerId, sessionToken } = state;
  void startReceive(current, () => admit({ version: 1, generation: current.generation, roomId, peerId, sessionToken }));
}

async function within<T>(operation: () => Promise<T>, ms = COMMAND_TIMEOUT_MS): Promise<T> {
  let timer: Timer | undefined;
  try {
    return await Promise.race([
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Native voice command timed out')), ms);
      }),
      operation()
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function mapOutput(bridge: NativeVoiceBridge, id: string): Promise<string | null | undefined> {
  if (!id || id === 'default') return null;
  const [devices, outputs] = await within(() =>
    Promise.all([navigator.mediaDevices?.enumerateDevices() ?? [], bridge.listOutputs()])
  ).catch(() => [[], []] as const);
  const label = devices
    .find((device) => device.kind === 'audiooutput' && device.deviceId === id)
    ?.label.trim()
    .toLowerCase();
  if (!label) return undefined;
  const matches = outputs.filter((output) => output.name.trim().toLowerCase() === label);
  return matches.length === 1 ? matches[0]?.id : undefined;
}

async function selectedSettings(current: ReceiveSession): Promise<AppliedSettings | undefined> {
  while (session === current) {
    const id = current.settings.outputDeviceId;
    const selection =
      current.selection?.id === id
        ? current.selection
        : (current.selection = { id, resolved: mapOutput(current.bridge, id) });
    const outputDeviceId = await selection.resolved;
    if (session !== current) return undefined;
    if (current.selection !== selection || current.settings.outputDeviceId !== id) continue;
    if (outputDeviceId !== undefined) return { ...current.settings, outputDeviceId };
    fallback(current, 'unsupported_output');
  }
  return undefined;
}

async function startReceive(current: ReceiveSession, admit: () => Promise<NativeVoiceAdmission>): Promise<void> {
  const { bridge, callId } = current;
  try {
    const status = await within(() => bridge.getCapability());
    if (session !== current) return;
    if (!status.available || status.protocol.major !== 1) {
      // Unavailable and older shells use the same path as a missing preload.
      dispose(current);
      fellBack = true;
      return;
    }
    if (!(await selectedSettings(current))) return;
  } catch {
    fallback(current, 'capability_failed');
    return;
  }
  const admission = await within(admit).catch(() => null);
  if (session !== current) return;
  if (!admission || admission.generation !== current.generation) {
    fallback(current, 'admission_refused');
    return;
  }
  if (admission.expiresAt <= Date.now()) {
    fallback(current, 'admission_expired');
    return;
  }
  armTimer(current, 'expiryTimer', admission.expiresAt - Date.now(), 'admission_expired');
  const settings = await selectedSettings(current);
  if (!settings || session !== current) return;
  try {
    current.unsubscribe = bridge.onEvent((event) => onEvent(current, event));
    // Probe while Chromium plays. Receiving and decoding continue with the
    // helper's render gain at zero, so there is only one audible route.
    current.startSent = true;
    resetStatsTimer(current);
    const result = await within(() =>
      bridge
        .start({ ...settings, muted: true, callId, url: admission.url, token: admission.token })
        .then((response) => {
          if (session !== current) void stop(current);
          return response;
        })
    );
    if (session !== current) return;
    if (!result.ok) {
      fallback(current, 'start_refused');
      return;
    }
    current.applied = settings;
    await reconcile(current);
  } catch {
    fallback(current, 'start_failed');
  }
}

async function reconcile(current: ReceiveSession): Promise<void> {
  current.dirty = true;
  if (current.updating) return;
  current.updating = true;
  try {
    while (session === current && current.dirty && current.applied) {
      current.dirty = false;
      const settings = await selectedSettings(current);
      if (!settings || session !== current) return;

      const before = current.applied;
      const tracksChanged = !sameTracks(settings.tracks, before.tracks);
      const outputChanged = settings.outputDeviceId !== before.outputDeviceId;
      if (!tracksChanged && !outputChanged) {
        if (
          !current.dirty &&
          current.phase === 'probe' &&
          current.connected &&
          current.ready &&
          current.progressed &&
          settings.tracks.length > 0 &&
          !outputMuted()
        ) {
          await beginHandoff(current);
        }
        continue;
      }

      const result = await within(() =>
        current.bridge.update({
          callId: current.callId,
          ...(tracksChanged && { tracks: settings.tracks }),
          ...(outputChanged && { outputDeviceId: settings.outputDeviceId })
        })
      );
      if (session !== current) return;
      if (!result.ok) {
        fallback(current, 'update_refused');
        return;
      }
      if (tracksChanged && current.phase === 'probe') {
        delete current.stats;
        current.progressed = false;
      }
      current.applied = settings;
    }
  } catch {
    fallback(current, 'update_failed');
  } finally {
    current.updating = false;
  }
}

function syncOutputMute(current: ReceiveSession): void {
  const muted = outputMuted();
  if (muted === current.requestedMute) return;
  if (muted && current.unmutePending) {
    // Fence a late unmute acknowledgment with stop. Send mute immediately,
    // even if the helper is still processing the preceding command.
    void updateMute(current, true);
    fallback(current, 'deafened_during_unmute');
    return;
  }
  if (current.phase !== 'confirming' && current.phase !== 'active') return;
  void updateMute(current, muted);
  if (current.phase === 'active') syncNativeVoiceSpeakers();
}

async function updateMute(current: ReceiveSession, muted: boolean): Promise<boolean> {
  current.requestedMute = muted;
  if (!muted) current.unmutePending = true;
  try {
    const result = await within(() => current.bridge.update({ callId: current.callId, muted }), HANDOFF_TIMEOUT_MS);
    if (session !== current) return false;
    if (result.ok) return true;
    fallback(current, muted ? 'mute_refused' : 'unmute_refused');
  } catch {
    fallback(current, muted ? 'mute_failed' : 'unmute_failed');
  } finally {
    if (!muted) current.unmutePending = false;
  }
  return false;
}

async function beginHandoff(current: ReceiveSession): Promise<void> {
  current.phase = 'unmuting';
  if (!(await updateMute(current, false)) || session !== current) return;
  current.phase = 'confirming';
  syncOutputMute(current);
  if (session !== current) return;
  current.progressed = false;
  setBrowserVoiceHandoffMuted(true);
  current.confirmationTimer = setTimeout(() => {
    if (!current.progressed) {
      fallback(current, 'handoff_stalled');
      return;
    }
    current.phase = 'active';
    try {
      suspendBrowserVoice();
    } catch {
      fallback(current, 'handoff_failed');
    } finally {
      setBrowserVoiceHandoffMuted(false);
    }
  }, HANDOFF_TIMEOUT_MS);
}

function sameTracks(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((sid, i) => sid === b[i]);
}

function onEvent(current: ReceiveSession, event: NativeVoiceEvent): void {
  if (session !== current || event.callId !== current.callId) return;
  switch (event.kind) {
    case 'media-ready':
      if (!current.connected) break;
      current.ready = true;
      void reconcile(current);
      break;
    case 'stats': {
      const before = current.stats;
      if (current.phase === 'active' && before) accumulateVoiceDeltas(current.deltas, event, before);
      if (!current.connected && current.phase !== 'active') break;
      current.stats = event;
      const received = (event.totalSamplesReceived ?? 0) > (before?.totalSamplesReceived ?? 0);
      const emitted = event.jitterBufferEmittedCount > (before?.jitterBufferEmittedCount ?? 0);
      const grew = before !== undefined && (received || emitted);
      if (current.phase === 'confirming') current.progressed = grew;
      if (grew) {
        current.progressed = true;
        resetStatsTimer(current);
        if (current.phase === 'probe') void reconcile(current);
      }
      break;
    }
    case 'transport': {
      current.connected = event.state === 'connected';
      if (current.phase !== 'active') {
        delete current.stats;
        current.progressed = false;
        if (!current.connected) {
          current.ready = false;
          if (current.phase !== 'probe') {
            fallback(current, 'handoff_disconnected');
            break;
          }
        }
      }
      if (event.state !== 'disconnected') {
        clearTimeout(current.transportTimer);
        delete current.transportTimer;
      } else if (current.transportTimer === undefined) {
        armTimer(current, 'transportTimer', TRANSPORT_TIMEOUT_MS, 'transport_disconnected');
      }
      break;
    }
    case 'fault':
      fallback(current, 'helper_fault', event.code);
      break;
    case 'stopped':
      fallback(current, 'helper_stopped');
      break;
    case 'device':
      if (event.outputDeviceId !== null && event.outputDeviceId !== event.effectiveOutputDeviceId) {
        fallback(current, 'unsupported_output');
      }
      break;
  }
}

function accumulateVoiceDeltas(deltas: VoiceDeltas, now: NativeVoiceStats, before: NativeVoiceStats): void {
  const emitted = counterGrowth(now.jitterBufferEmittedCount, before.jitterBufferEmittedCount);
  deltas.bufferSamples += emitted;
  deltas.bufferSeconds +=
    now.jitterBufferEmittedCount < before.jitterBufferEmittedCount
      ? now.jitterBufferDelaySeconds
      : counterGrowth(now.jitterBufferDelaySeconds, before.jitterBufferDelaySeconds);
  deltas.playedSamples +=
    !now.totalSamplesReceived || before.totalSamplesReceived === undefined
      ? emitted
      : counterGrowth(now.totalSamplesReceived, before.totalSamplesReceived);
  deltas.concealedSamples += counterGrowth(
    speechConcealment(now.concealedSamples, now.silentConcealedSamples),
    speechConcealment(before.concealedSamples, before.silentConcealedSamples)
  );
  deltas.gaps += counterGrowth(now.concealmentEvents, before.concealmentEvents);
}

function armTimer(current: ReceiveSession, key: TimerKey, ms: number, reason: string): void {
  clearTimeout(current[key]);
  current[key] = setTimeout(() => fallback(current, reason), ms);
}

function resetStatsTimer(current: ReceiveSession): void {
  clearTimeout(current.statsTimer);
  if (current.settings.tracks.length > 0) {
    armTimer(current, 'statsTimer', STATS_TIMEOUT_MS, 'stats_stalled');
  }
}

function suspendBrowserVoice(): void {
  nativeReceiveRoute.active = true;
  for (const peer of state.peers.values()) {
    if (peer.isLocal || peer.id === state.peerId) continue;
    removeAudioElements(peer);
    peer.stream = null;
    peer.micReceiver = null;
    detachMeter(peer);
  }
  syncLiveKitVoiceSubscriptions();
  syncNativeVoiceSpeakers();
}

function noteFallback(reason: string, code?: string): void {
  fellBack = true;
  log.warn('native receive fallback', { reason, ...(code && /^[\w-]{1,64}$/.test(code) ? { code } : {}) });
}

function dispose(current: ReceiveSession): void {
  session = undefined;
  delete nativeReceiveRoute.settingsChanged;
  clearTimeout(current.statsTimer);
  clearTimeout(current.transportTimer);
  clearTimeout(current.expiryTimer);
  clearTimeout(current.confirmationTimer);
  current.unsubscribe?.();
}

async function stop(current: ReceiveSession): Promise<void> {
  if (current.startSent) {
    await within(() => current.bridge.stop({ callId: current.callId }), STOP_TIMEOUT_MS).catch(() => {
      log.warn('native receive stop did not complete');
    });
  }
}

function fallback(current: ReceiveSession, reason: string, code?: string): void {
  if (session !== current) return;
  noteFallback(reason, code);
  dispose(current);
  if (current.phase === 'confirming') setBrowserVoiceHandoffMuted(false);
  if (current.phase === 'active') restoring = current;
  void stop(current).then(() => {
    if (restoring !== current) return;
    restoring = undefined;
    nativeReceiveRoute.active = false;
    for (const peer of state.peers.values()) setParticipantSpeaking(peer, false);
    syncLiveKitVoiceSubscriptions();
  });
}

export function resetNativeVoiceReceive(): void {
  capability = undefined;
  setNativeVoiceCompanions(undefined);
  fellBack = false;
  restoring = undefined;
  nativeReceiveRoute.active = false;
  setBrowserVoiceHandoffMuted(false);
  const current = session;
  if (!current) return;
  dispose(current);
  void stop(current);
}
