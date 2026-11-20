import { createHash, randomBytes } from 'node:crypto';
import { access, link, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { codeOf } from '../../platform/error-code.ts';

const SECRET_BYTES = 32;

export function createOwnerSecretRepository(file: string) {
  // A separate claim for each secret lets rotation publish a fresh generation
  // atomically without making any previous link reusable.
  const claimPath = (secret: Buffer) => `${file}.${createHash('sha256').update(secret).digest('hex')}.used`;

  async function read(): Promise<Buffer | null> {
    try {
      const secret = await readFile(file);
      if (secret.length !== SECRET_BYTES) throw new Error('Invalid installation owner secret');
      return secret;
    } catch (error) {
      if (codeOf(error) === 'ENOENT') return null;
      throw error;
    }
  }

  async function replace({ rotate }: { rotate: boolean }): Promise<Buffer> {
    const previous = await read();
    if (previous && !rotate) return previous;
    const secret = randomBytes(SECRET_BYTES);
    const temporary = `${file}.${randomBytes(16).toString('hex')}.new`;
    try {
      await writeFile(temporary, secret, { flag: 'wx', mode: 0o600, flush: true });
      if (rotate) {
        await rename(temporary, file);
        if (previous) await rm(claimPath(previous), { force: true });
      } else {
        await link(temporary, file);
      }
      return secret;
    } catch (error) {
      if (!rotate && codeOf(error) === 'EEXIST') {
        const winner = await read();
        if (winner) return winner;
      }
      throw error;
    } finally {
      await rm(temporary, { force: true });
    }
  }

  async function consumeLink(secret: Buffer): Promise<boolean> {
    try {
      await writeFile(claimPath(secret), '', { flag: 'wx', mode: 0o600, flush: true });
    } catch (error) {
      if (codeOf(error) === 'EEXIST') return false;
      throw error;
    }
    const current = await read();
    if (current?.equals(secret)) return true;
    await rm(claimPath(secret), { force: true });
    return false;
  }

  async function linkWasUsed(secret: Buffer): Promise<boolean> {
    try {
      await access(claimPath(secret));
      return true;
    } catch (error) {
      if (codeOf(error) === 'ENOENT') return false;
      throw error;
    }
  }

  return { read, replace, consumeLink, linkWasUsed };
}
