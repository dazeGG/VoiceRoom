import { createHmac, timingSafeEqual } from 'node:crypto';
import { createOwnerSecretRepository } from './meet-owner.repository.ts';

const CREATE_AUTHORIZATION_MS = 5 * 60_000;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const AUTHORIZATION = /^([1-9][0-9]{0,15})\.([A-Za-z0-9_-]{43})$/;

function sign(secret: Buffer, scope: string): string {
  return createHmac('sha256', secret).update(scope).digest('base64url');
}

function signatureMatches(expected: string, supplied: string): boolean {
  return timingSafeEqual(Buffer.from(expected), Buffer.from(supplied));
}

export function createOwnerCapability(file: string, now = Date.now) {
  const repository = createOwnerSecretRepository(file);

  async function printLink({ origin, rotate }: { origin: string; rotate: boolean }): Promise<string | null> {
    const secret = await repository.replace({ rotate });
    if (await repository.linkWasUsed(secret)) return null;
    const url = new URL('/', origin);
    url.hash = `owner=${sign(secret, 'meet:owner-link')}`;
    return url.href;
  }

  async function exchangeLink(token: string): Promise<string | null> {
    if (!TOKEN.test(token)) return null;
    const secret = await repository.read();
    if (!secret || !signatureMatches(sign(secret, 'meet:owner-link'), token)) return null;
    if (!(await repository.consumeLink(secret))) return null;
    const expiresAt = now() + CREATE_AUTHORIZATION_MS;
    return `${expiresAt}.${sign(secret, `meet:create:${expiresAt}`)}`;
  }

  async function canCreate(authorization: string | undefined): Promise<boolean> {
    const match = AUTHORIZATION.exec(authorization ?? '');
    const expiresAt = match?.[1];
    const signature = match?.[2];
    if (!expiresAt || !signature || Number(expiresAt) <= now()) return false;
    // Read the current file for every authorization so a separate CLI process
    // can rotate the owner secret without restarting the API.
    const secret = await repository.read();
    return Boolean(secret && signatureMatches(sign(secret, `meet:create:${expiresAt}`), signature));
  }

  return { printLink, exchangeLink, canCreate };
}

export type OwnerCapability = Pick<ReturnType<typeof createOwnerCapability>, 'exchangeLink' | 'canCreate'>;
