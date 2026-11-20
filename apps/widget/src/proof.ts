import { PowChallenge } from '@voice-room/shared/contracts/ops';
import { widgetRequest } from './http';
export async function widgetProof(signal?: AbortSignal): Promise<{ challenge: string; nonce: number } | null> {
  const challenge = await widgetRequest('/api/pow-challenge', PowChallenge, undefined, signal);
  if (!challenge.required) return null;
  if (
    !Number.isInteger(challenge.difficulty) ||
    challenge.difficulty < 0 ||
    challenge.difficulty > 32 ||
    !Number.isFinite(challenge.expiresAt)
  )
    throw new Error('Некорректная проверка создания комнаты');
  for (let nonce = 0; Date.now() < challenge.expiresAt; nonce++) {
    signal?.throwIfAborted();
    const hash = new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${challenge.challenge}:${nonce}`))
    );
    let bits = challenge.difficulty;
    for (const byte of hash) {
      if (bits <= 0) break;
      const take = Math.min(8, bits);
      if (byte >>> (8 - take)) break;
      bits -= take;
    }
    if (bits <= 0) return { challenge: challenge.challenge, nonce };
    if (nonce % 250 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error('Проверка создания комнаты истекла');
}
