import { fetchJson } from './http';

const ROOM_PROOF_BATCH_SIZE = 250;

interface PowChallenge {
  challenge?: string;
  difficulty?: number;
  expiresAt?: number;
  required: boolean;
}

export interface RoomProof {
  challenge: string;
  nonce: number;
}

export async function createRoomProof(): Promise<RoomProof | null> {
  const challenge = await fetchJson<PowChallenge>('/api/pow-challenge');
  if (!challenge.required) return null;

  if (!window.crypto?.subtle || typeof TextEncoder !== 'function') {
    throw new Error('Откройте сайт через HTTPS или localhost');
  }

  return {
    challenge: normalizeChallenge(challenge.challenge),
    nonce: await solveProofOfWork(
      normalizeChallenge(challenge.challenge),
      Number(challenge.difficulty),
      Number(challenge.expiresAt)
    )
  };
}

async function solveProofOfWork(challenge: string, difficulty: number, expiresAt: number): Promise<number> {
  if (!Number.isInteger(difficulty) || difficulty < 0 || difficulty > 32) throw new Error('Не удалось создать комнату');
  if (!Number.isFinite(expiresAt)) throw new Error('Не удалось создать комнату');

  const encoder = new TextEncoder();
  let nonce = 0;
  while (Date.now() < expiresAt) {
    for (let index = 0; index < ROOM_PROOF_BATCH_SIZE; index += 1) {
      const data = encoder.encode(`${challenge}:${nonce}`);
      const hash = new Uint8Array(await window.crypto.subtle.digest('SHA-256', data));
      if (hasLeadingZeroBits(hash, difficulty)) return nonce;
      nonce += 1;
    }
    await waitForUi();
  }

  throw new Error('Проверка создания комнаты истекла');
}

function normalizeChallenge(challenge: unknown): string {
  if (typeof challenge !== 'string' || !challenge) throw new Error('Не удалось создать комнату');
  return challenge;
}

function hasLeadingZeroBits(bytes: Uint8Array, bitCount: number): boolean {
  let remainingBits = bitCount;
  for (const byte of bytes) {
    if (remainingBits <= 0) return true;
    if (remainingBits >= 8) {
      if (byte !== 0) return false;
      remainingBits -= 8;
      continue;
    }
    const mask = 0xff << (8 - remainingBits) & 0xff;
    return (byte & mask) === 0;
  }
  return remainingBits <= 0;
}

function waitForUi(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, 0));
}
