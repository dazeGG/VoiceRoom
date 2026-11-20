import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';
import type { Plugin } from 'vite';

// Not .svg: the emoji are thousands of tiny files, which Caddy compresses on the fly.
const COMPRESSED_TYPES = new Set(['.css', '.html', '.js', '.json', '.mjs', '.wasm']);
const MIN_COMPRESSED_BYTES = 1024;

function compressTree(directory: string): void {
  for (const name of readdirSync(directory)) {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) {
      compressTree(path);
      continue;
    }
    if (!COMPRESSED_TYPES.has(extname(name))) continue;
    const source = readFileSync(path);
    if (source.length < MIN_COMPRESSED_BYTES) continue;
    writeFileSync(
      `${path}.br`,
      brotliCompressSync(source, { params: { [constants.BROTLI_PARAM_QUALITY]: constants.BROTLI_MAX_QUALITY } })
    );
    writeFileSync(`${path}.gz`, gzipSync(source, { level: constants.Z_BEST_COMPRESSION }));
  }
}

/** Writes .br and .gz next to the build's files, at a strength too slow to spend on every request (Caddyfile). */
export function precompressPlugin(): Plugin {
  let outDir = '';
  return {
    name: 'voiceroom-precompress',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    writeBundle() {
      compressTree(outDir);
    }
  };
}
