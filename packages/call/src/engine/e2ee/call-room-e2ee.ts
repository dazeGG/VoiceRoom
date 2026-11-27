// End-to-end encryption of a 1:1 friend call room, from LiveKit room creation to the agreed key.
//
// Every call room is created with frame encryption on before it connects. Until the key agreement completes the
// SDK holds no key and drops every outgoing frame, so nothing decodable leaves the device; a microphone published
// while the peer is still ringing starts to be heard once both sides hold the key. A remote publication that is
// not encrypted is never subscribed (see `isCallPublicationAllowed`), since only the server could have put it there.
// There is no cleartext fallback: a failed agreement leaves the call silent and says so on the stage.

import type { RemoteParticipant, RemoteTrackPublication, Room, RoomOptions } from 'livekit-client';
import { CALL_KEY_AGREEMENT_ATTRIBUTE } from '@voiceroom/shared/contracts/rings';
import { isLiveKitOnlyIdentity } from '@voiceroom/shared/validation';
import { state } from '../core/room-runtime.store';
import { createLogger, errorContext } from '../diagnostics';
import { loadLiveKitClient } from '../media/livekit-runtime';
import { startKeyAgreement, type KeyAgreement, type KeyAgreementChannel } from './key-agreement';

const log = createLogger('room:e2ee');
// The roster that names the peer can arrive after its LiveKit participant; look again until the key is agreed.
const PEER_RECHECK_MS = 1_000;

interface CallKeyProvider {
  setCallKey(key: ArrayBuffer, index: number): Promise<void>;
}

interface RoomEncryption {
  provider: CallKeyProvider;
  worker: Worker;
  agreement?: KeyAgreement;
  stopListening?: () => void;
}

const encryptions = new WeakMap<Room, RoomEncryption>();

/** Whether this device's receiver takes RED audio, so the peer may send it under E2EE. */
export function receiverTakesRed(): boolean {
  const codecs = globalThis.RTCRtpReceiver?.getCapabilities?.('audio')?.codecs ?? [];
  return codecs.some((codec) => /^audio\/red$/i.test(codec.mimeType));
}

/** The room options and a disposer for one E2EE call room candidate. */
export async function createCallRoomEncryption(): Promise<{
  options: NonNullable<RoomOptions['encryption']>;
  bind(room: Room): void;
  dispose(): void;
}> {
  const { BaseKeyProvider, createKeyMaterialFromBuffer, createE2eeWorker } = await loadLiveKitClient();
  // A shared key: both sides use the agreed key; a failed decrypt never marks it invalid or ratchets it.
  class AgreedKeyProvider extends BaseKeyProvider implements CallKeyProvider {
    constructor() {
      super({ sharedKey: true, ratchetWindowSize: 0, failureTolerance: -1 });
    }
    async setCallKey(key: ArrayBuffer, index: number): Promise<void> {
      // Raw key bytes make the SDK derive the frame key with HKDF, as the native receiver does.
      this.onSetEncryptionKey(await createKeyMaterialFromBuffer(key), undefined, index);
    }
  }
  const provider = new AgreedKeyProvider();
  const worker = await createE2eeWorker();
  return {
    options: { keyProvider: provider, worker },
    bind(room) {
      encryptions.set(room, { provider, worker });
    },
    dispose() {
      worker.terminate();
    }
  };
}

/** A remote publication a call room may subscribe to: only encrypted media in an E2EE call. */
export function isCallPublicationAllowed(publication: RemoteTrackPublication): boolean {
  return !state.callId || publication.isEncrypted;
}

function peerParticipant(room: Room): RemoteParticipant | undefined {
  // The peer is the one main participant the API roster seated, never a companion or a stranger the SFU added.
  for (const participant of room.remoteParticipants.values()) {
    if (isLiveKitOnlyIdentity(participant.identity)) continue;
    if (state.serverPeerIds.has(participant.identity)) return participant;
  }
  return undefined;
}

function setPhase(next: NonNullable<typeof state.callE2ee>): void {
  state.callE2ee = next;
}

/**
 * Starts the key agreement of a connected call room. `current` says whether the room is still the call's room;
 * the agreement stops with `stopCallRoomE2ee`.
 */
export async function startCallRoomE2ee(
  room: Room,
  current: () => boolean,
  onPeerRed: (peerRed: boolean) => void
): Promise<void> {
  const encryption = encryptions.get(room);
  const callId = state.callId;
  if (!encryption || !callId || encryption.agreement) return;
  const { RoomEvent } = await loadLiveKitClient();
  if (!current()) return;
  setPhase({ phase: 'agreeing', code: null, failure: null });

  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((listener) => listener());
  const events = [
    RoomEvent.ParticipantAttributesChanged,
    RoomEvent.ParticipantConnected,
    RoomEvent.ParticipantDisconnected
  ] as const;
  for (const event of events) room.on(event, notify);
  const recheck = setInterval(() => {
    if (state.callE2ee?.phase !== 'secured') notify();
  }, PEER_RECHECK_MS);

  const channel: KeyAgreementChannel = {
    async publish(value) {
      await room.localParticipant.setAttributes({ [CALL_KEY_AGREEMENT_ATTRIBUTE]: value });
    },
    read: () => peerParticipant(room)?.attributes[CALL_KEY_AGREEMENT_ATTRIBUTE],
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
  };

  encryption.stopListening = () => {
    clearInterval(recheck);
    for (const event of events) room.off(event, notify);
  };
  encryption.agreement = startKeyAgreement({
    role: state.callE2eeInitiator ? 'initiator' : 'responder',
    callId,
    channel,
    red: receiverTakesRed(),
    onKey({ key, index, code, peerRed }) {
      void encryption.provider.setCallKey(key, index).then(
        () => {
          if (!current()) return;
          setPhase({ phase: 'secured', code, failure: null });
          onPeerRed(peerRed);
        },
        (error: unknown) => {
          log.warn('call key rejected', errorContext(error));
          if (current()) setPhase({ phase: 'failed', code: null, failure: 'tampered' });
        }
      );
    },
    onFailure(failure) {
      log.warn('call key agreement failed', { failure });
      if (current()) setPhase({ phase: 'failed', code: null, failure });
    }
  });
}

/** Ends the key agreement of a room being left or replaced. */
export function stopCallRoomE2ee(room: Room): void {
  const encryption = encryptions.get(room);
  if (!encryption) return;
  encryption.agreement?.stop();
  encryption.stopListening?.();
  encryption.worker.terminate();
  encryptions.delete(room);
}

/** After an in-place reconnect, publishes this side's state again in case the server lost it. */
export async function republishCallRoomE2ee(room: Room): Promise<void> {
  const agreement = encryptions.get(room)?.agreement;
  if (!agreement) return;
  await room.localParticipant
    .setAttributes({ [CALL_KEY_AGREEMENT_ATTRIBUTE]: agreement.state() })
    .catch((error: unknown) => log.warn('call key state republish failed', errorContext(error)));
}
