import { ROOM_PROOF_BATCH_SIZE } from '../core/config';
import { fetchJson } from './api';
import { hasLeadingZeroBits, waitForUi } from '../core/utils';

export interface RoomProof {
  challenge: string;
  nonce: number;
}

export async function createRoomProof(): Promise<RoomProof | null> {
  const challenge = await fetchJson('/pow-challenge');
  if (!challenge.required) return null;

  if (!window.crypto?.subtle || typeof TextEncoder !== 'function') {
    throw new Error('Откройте сайт через HTTPS или localhost');
  }

  return {
    challenge: challenge.challenge,
    nonce: await solveProofOfWork(challenge.challenge, challenge.difficulty, challenge.expiresAt)
  };
}

export async function solveProofOfWork(challenge: string, difficulty: number, expiresAt: number): Promise<number> {
  const targetBits = Number(difficulty);
  const expiresAtMs = Number(expiresAt);
  if (typeof challenge !== 'string' || !challenge) throw new Error('Не удалось создать комнату');
  if (!Number.isInteger(targetBits) || targetBits < 0 || targetBits > 32) throw new Error('Не удалось создать комнату');
  if (!Number.isFinite(expiresAtMs)) throw new Error('Не удалось создать комнату');

  const encoder = new TextEncoder();
  let nonce = 0;
  while (Date.now() < expiresAtMs) {
    for (let index = 0; index < ROOM_PROOF_BATCH_SIZE; index += 1) {
      const data = encoder.encode(`${challenge}:${nonce}`);
      const hash = new Uint8Array(await window.crypto.subtle.digest('SHA-256', data));
      if (hasLeadingZeroBits(hash, targetBits)) return nonce;
      nonce += 1;
    }
    await waitForUi();
  }

  throw new Error('Проверка создания комнаты истекла');
}
