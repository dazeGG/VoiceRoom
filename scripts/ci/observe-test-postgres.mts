// Loaded only in proof workers and their descendants. Observe, never intercept,
// the actual connection attempt, including attempts whose error the test catches.
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import pg from 'pg';

const dir = process.env.API_PROOF_DIR;
if (!dir) throw new Error('Missing API proof directory');
const marker =
  process.env.API_PROOF_MARKER ?? join(dir, relative(process.cwd(), resolve(process.argv[1] ?? 'unknown')));
if (!process.env.API_PROOF_MARKER) {
  mkdirSync(dirname(marker), { recursive: true });
  writeFileSync(marker, '');
  process.env.API_PROOF_MARKER = marker;
  process.env.NODE_OPTIONS = [process.env.NODE_OPTIONS, `--import=${import.meta.url}`].filter(Boolean).join(' ');
}
pg.Client.prototype.connect = new Proxy(Reflect.get(pg.Client.prototype, 'connect'), {
  apply(target, client: pg.Client, args: unknown[]): unknown {
    appendFileSync(marker, 'connect\n');
    return Reflect.apply(target, client, args);
  }
});
