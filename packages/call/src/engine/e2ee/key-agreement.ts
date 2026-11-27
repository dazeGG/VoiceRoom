// Per-call key agreement for 1:1 friend calls (ZRTP-style commit, hello, reveal).
//
// The two main participants of a call room agree a fresh media key K and a 4-emoji safety code by publishing
// one JSON state each over a side channel the server relays (LiveKit participant attributes). The server can read
// and rewrite those states. It cannot learn K, because K comes from an X25519 exchange of ephemeral keys. It cannot
// sit in the middle unnoticed either: the initiator commits to its key before it sees the responder's, so a relay
// that substitutes keys has to fix both of its own keys blind, and the two sides then show different codes except
// with probability 2^-24.
//
// Each page instance has its own random session id (`sid`). A responder answers only a commit addressed to its
// current sid, and the initiator starts over whenever the responder's sid changes, so a reload on either side runs
// a fresh agreement and a stale state can never complete one. Every completed agreement installs its key at the
// index the initiator chose, so frames sent under the old key still decrypt while both sides switch.

import {
  CALL_KEY_RING_SIZE,
  parseCallKeyAgreementState,
  type CallKeyAgreementState
} from '@voiceroom/shared/contracts/rings';
import { safetyCode, type SafetyEmoji } from './safety-code';

const LABEL = 'voiceroom/e2ee/call/v1';

/** The relay between the two sides. Only the peer's state reaches `read` and `subscribe`. */
export interface KeyAgreementChannel {
  publish(state: string): Promise<void>;
  read(): string | undefined;
  subscribe(listener: () => void): () => void;
}

export interface AgreedKey {
  key: ArrayBuffer;
  index: number;
  code: SafetyEmoji[];
  /** The peer's receiver takes RED. */
  peerRed: boolean;
}

export type KeyAgreementFailure = 'tampered' | 'timeout' | 'unsupported';

export interface KeyAgreementOptions {
  role: 'initiator' | 'responder';
  callId: string;
  channel: KeyAgreementChannel;
  red: boolean;
  onKey(agreed: AgreedKey): void;
  onFailure(reason: KeyAgreementFailure): void;
  /** How long one step may wait for the peer. */
  stepTimeoutMs?: number;
  /** Initiator: how many times an agreement that timed out is tried again before `onFailure('timeout')`. */
  retries?: number;
}

interface Ephemeral {
  privateKey: CryptoKey;
  publicKey: Uint8Array<ArrayBuffer>;
}

const utf8 = (text: string) => new TextEncoder().encode(text);
const hex = (bytes: ArrayBuffer | Uint8Array) =>
  Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
function unhex(text: string): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(text.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = Number.parseInt(text.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}
function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
const randomHex = (bytes: number) => hex(crypto.getRandomValues(new Uint8Array(bytes)));

async function commitment(initiatorPublic: Uint8Array, callId: string, hs: string): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', concat(initiatorPublic, utf8(callId), unhex(hs))));
}

/**
 * K and the safety code from one side's ephemeral private key and the other side's public key. Both sides pass the
 * transcript in the same order, initiator first.
 */
export async function deriveCallKey(input: {
  privateKey: CryptoKey;
  peerPublic: Uint8Array<ArrayBuffer>;
  callId: string;
  hs: string;
  initiator: { sid: string; publicKey: Uint8Array };
  responder: { sid: string; publicKey: Uint8Array };
}): Promise<{ key: ArrayBuffer; code: SafetyEmoji[] }> {
  const peer = await crypto.subtle.importKey('raw', input.peerPublic, { name: 'X25519' }, true, []);
  const shared = await crypto.subtle.deriveBits({ name: 'X25519', public: peer }, input.privateKey, 256);
  const material = await crypto.subtle.importKey('raw', shared, 'HKDF', false, ['deriveBits']);
  const transcript = concat(
    utf8(LABEL),
    utf8(input.callId),
    unhex(input.hs),
    unhex(input.initiator.sid),
    unhex(input.responder.sid),
    input.initiator.publicKey,
    input.responder.publicKey
  );
  const expand = (label: string, bits: number) =>
    crypto.subtle.deriveBits(
      { name: 'HKDF', hash: 'SHA-256', salt: utf8(input.callId), info: concat(transcript, utf8(label)) },
      material,
      bits
    );
  const key = await expand('media', 256);
  const code = safetyCode(new Uint8Array(await expand('sas', 32)));
  return { key, code };
}

async function ephemeral(): Promise<Ephemeral> {
  const pair = await crypto.subtle.generateKey({ name: 'X25519' }, false, ['deriveBits']);
  if (!('privateKey' in pair)) throw new TypeError('X25519 did not give a key pair');
  return {
    privateKey: pair.privateKey,
    publicKey: new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))
  };
}

/**
 * Runs the agreement for as long as the call lasts: the first one, and a new one each time either side starts
 * over. `stop()` ends it; a key already handed to `onKey` stays the caller's to discard.
 */
export function startKeyAgreement(options: KeyAgreementOptions) {
  const { role, callId, channel, red } = options;
  const stepTimeoutMs = options.stepTimeoutMs ?? 8_000;
  const retries = options.retries ?? 2;
  const sid = randomHex(16);
  let stopped = false;
  let own: CallKeyAgreementState = { v: 1, sid, red };
  let nextIndex = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let queue = Promise.resolve();

  // Initiator: the agreement waiting for a hello, and the responder instance of the last completed one.
  let pending: (Ephemeral & { hs: string; peerSid: string; index: number }) | undefined;
  let agreedWith: string | undefined;
  // Responder: the commit answered and waiting for its reveal, and the agreements already completed.
  let answering: (Ephemeral & { hs: string; commit: string; peerSid: string; index: number }) | undefined;
  const completed = new Set<string>();

  const publish = (state: CallKeyAgreementState) => {
    own = state;
    return channel.publish(JSON.stringify(state));
  };
  const disarm = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  const arm = (onTimeout: () => Promise<void> | void) => {
    disarm();
    timer = setTimeout(() => {
      timer = undefined;
      void enqueue(async () => onTimeout());
    }, stepTimeoutMs);
  };
  const fail = (reason: KeyAgreementFailure) => {
    disarm();
    pending = undefined;
    answering = undefined;
    if (!stopped) options.onFailure(reason);
  };

  async function beginAgreement(peerSid: string, attempts = 0): Promise<void> {
    const pair = await ephemeral();
    const hs = randomHex(16);
    const index = nextIndex;
    nextIndex = (nextIndex + 1) % CALL_KEY_RING_SIZE;
    pending = { hs, peerSid, index, ...pair };
    const commit = await commitment(pair.publicKey, callId, hs);
    await publish({ v: 1, sid, red, hs, to: peerSid, index, commit });
    arm(async () => {
      if (pending?.hs !== hs) return;
      if (attempts >= retries) fail('timeout');
      else await beginAgreement(peerSid, attempts + 1);
    });
  }

  async function initiatorStep(peer: CallKeyAgreementState) {
    if (pending && peer.sid !== pending.peerSid) pending = undefined;
    if (!pending) {
      if (peer.sid !== agreedWith) await beginAgreement(peer.sid);
      return;
    }
    if (peer.hs !== pending.hs || !peer.hello) return;
    const { hs, index, privateKey, publicKey, peerSid } = pending;
    pending = undefined;
    disarm();
    const responderPublic = unhex(peer.hello);
    await publish({ ...own, reveal: hex(publicKey) });
    const { key, code } = await deriveCallKey({
      privateKey,
      peerPublic: responderPublic,
      callId,
      hs,
      initiator: { sid, publicKey },
      responder: { sid: peerSid, publicKey: responderPublic }
    });
    agreedWith = peerSid;
    if (!stopped) options.onKey({ key, index, code, peerRed: peer.red });
  }

  async function responderStep(peer: CallKeyAgreementState) {
    const { hs, commit, index } = peer;
    if (peer.to !== sid || !hs || !commit || index === undefined || completed.has(hs)) return;
    if (answering?.hs !== hs) {
      const pair = await ephemeral();
      answering = { hs, commit, peerSid: peer.sid, index, ...pair };
      await publish({ v: 1, sid, red, hs, hello: hex(pair.publicKey) });
      arm(() => {
        if (answering?.hs === hs) answering = undefined;
      });
    }
    if (!peer.reveal || commit !== answering.commit || peer.sid !== answering.peerSid) return;
    const current = answering;
    answering = undefined;
    disarm();
    const initiatorPublic = unhex(peer.reveal);
    if ((await commitment(initiatorPublic, callId, current.hs)) !== current.commit) {
      fail('tampered');
      return;
    }
    completed.add(current.hs);
    const derived = await deriveCallKey({
      privateKey: current.privateKey,
      peerPublic: initiatorPublic,
      callId,
      hs: current.hs,
      initiator: { sid: current.peerSid, publicKey: initiatorPublic },
      responder: { sid, publicKey: current.publicKey }
    });
    if (!stopped) options.onKey({ ...derived, index: current.index, peerRed: peer.red });
  }

  function enqueue(step: () => Promise<unknown>) {
    // A step that throws met a key WebCrypto refused, such as a forged low-order point: no key comes of it.
    queue = queue.then(step).then(
      () => undefined,
      () => {
        fail('tampered');
      }
    );
    return queue;
  }

  function onPeer() {
    if (stopped) return;
    void enqueue(async () => {
      if (stopped) return;
      const peer = parseCallKeyAgreementState(channel.read());
      if (peer === 'unsupported') {
        fail('unsupported');
        return;
      }
      if (!peer) return;
      if (role === 'initiator') await initiatorStep(peer);
      else await responderStep(peer);
    });
  }

  const unsubscribe = channel.subscribe(onPeer);
  void enqueue(() => publish(own)).then(onPeer);

  return {
    /** Ends the agreement: no more keys, failures or published states. */
    stop() {
      stopped = true;
      disarm();
      unsubscribe();
      pending = undefined;
      answering = undefined;
    },
    /** The state this side publishes now; the engine republishes it after a LiveKit reconnect. */
    state: () => JSON.stringify(own),
    /** Settles once the queued steps have run. */
    idle: () => queue
  };
}

export type KeyAgreement = ReturnType<typeof startKeyAgreement>;
