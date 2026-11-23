import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { voiceAssetLicensePath, voiceAssetPaths } from '@voiceroom/call/voice-assets';
import type { Plugin } from 'vite';

export const voiceAssetDirectory = fileURLToPath(new URL('../../packages/call/assets', import.meta.url));
const audioPaths = Object.values(voiceAssetPaths);
const emittedPaths: readonly string[] = [...audioPaths, voiceAssetLicensePath];

/** Changes only when one of the files does, so a release does not make every visitor download them again. */
export function voiceAssetVersion(assetDir = voiceAssetDirectory): string {
  const hash = createHash('sha256');
  for (const path of audioPaths) hash.update(readFileSync(join(assetDir, path)));
  return hash.digest('hex').slice(0, 12);
}

/** Serve the package bytes at the same root-relative URLs in development and production. */
export function voiceAssetsPlugin(): Plugin {
  return {
    name: 'voiceroom-voice-assets',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const path = request.url?.split('?', 1)[0];
        if ((request.method !== 'GET' && request.method !== 'HEAD') || !path || !emittedPaths.includes(path)) {
          next();
          return;
        }
        const extension = extname(path);
        const contentType =
          path === voiceAssetLicensePath
            ? 'text/plain'
            : extension === '.wasm'
              ? 'application/wasm'
              : 'text/javascript';
        response.setHeader('Content-Type', contentType);
        response.setHeader('Cache-Control', 'no-cache');
        response.end(readFileSync(join(voiceAssetDirectory, path)));
      });
    },
    generateBundle() {
      for (const path of emittedPaths) {
        this.emitFile({
          type: 'asset',
          fileName: path.slice(1),
          source: readFileSync(join(voiceAssetDirectory, path))
        });
      }
    }
  };
}
