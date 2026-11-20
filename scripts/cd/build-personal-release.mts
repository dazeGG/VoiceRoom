import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { isRecord } from '../../packages/shared/src/guards.ts';

const composeFile = 'docker-compose.personal.yml';
const installerFile = 'install.sh';
const imageForService = {
  api: 'api',
  migrate: 'api',
  'livekit-gate': 'api',
  caddy: 'caddy',
  postgres: 'postgres',
  livekit: 'livekit'
} as const;

function sha256(bytes: string | Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function composeImage(services: Record<string, unknown>, name: string): string {
  const service = services[name];
  if (!isRecord(service) || typeof service.image !== 'string') throw new Error(`Missing ${name} image in Compose`);
  return service.image;
}

export function buildPersonalRelease({
  compose,
  installer,
  version,
  api,
  caddy,
  pinImage
}: {
  compose: unknown;
  installer: Buffer;
  version: string;
  api: string;
  caddy: string;
  pinImage: (image: string) => string;
}) {
  if (!/^meet\/v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/u.test(version))
    throw new Error('Expected a stable Meet release tag');
  if (!isRecord(compose) || !isRecord(compose.services)) throw new Error('Missing personal Compose services');
  const { services } = compose;
  const expected = Object.entries(imageForService);
  if (Object.keys(services).length !== expected.length) throw new Error('Unexpected personal Compose services');
  const images = {
    api,
    caddy,
    postgres: pinImage(composeImage(services, 'postgres')),
    livekit: pinImage(composeImage(services, 'livekit'))
  };
  for (const image of Object.values(images)) {
    if (!/^[a-z0-9./_-]+(?::\d+)?[a-z0-9./_-]*@sha256:[a-f0-9]{64}$/u.test(image)) {
      throw new Error(`Release image has no immutable digest: ${image}`);
    }
  }
  const pinnedServices = Object.fromEntries(
    expected.map(([name, image]) => {
      const service = services[name];
      if (!isRecord(service)) throw new Error(`Missing ${name} service in Compose`);
      const pinned = { ...service, image: images[image] };
      Reflect.deleteProperty(pinned, 'build');
      return [name, pinned];
    })
  );
  const model = Object.fromEntries(Object.entries(compose).filter(([name]) => !name.startsWith('x-')));
  // JSON is a subset of YAML. Compose already expands anchors while its
  // --no-interpolate option preserves the end user's environment expressions.
  const composeAsset = `${JSON.stringify({ ...model, services: pinnedServices }, null, 2)}\n`;
  return {
    composeAsset,
    manifest: {
      schemaVersion: 1,
      version,
      files: { [composeFile]: sha256(composeAsset), [installerFile]: sha256(installer) },
      images
    }
  };
}

if (import.meta.main) {
  const [version, api, caddy, outputPath] = process.argv.slice(2);
  if (!version || !api || !caddy || !outputPath)
    throw new Error('Usage: build-personal-release.mts <tag> <api image> <caddy image> <output directory>');
  const root = resolve(import.meta.dirname, '../..');
  const docker = (args: string[]) => execFileSync('docker', args, { cwd: root, encoding: 'utf8', timeout: 60000 });
  const compose: unknown = JSON.parse(
    docker([
      'compose',
      '-p',
      'voiceroom-personal',
      '-f',
      composeFile,
      'config',
      '--no-interpolate',
      '--no-normalize',
      '--no-path-resolution',
      '--no-env-resolution',
      '--format',
      'json'
    ])
  );
  const installer = readFileSync(join(root, 'apps/get', installerFile));
  const pinImage = (image: string) => {
    if (image.includes('@')) return image;
    const digest = docker(['buildx', 'imagetools', 'inspect', '--format', '{{.Manifest.Digest}}', '--', image]).trim();
    return `${image.replace(/:[^/:]+$/u, '')}@${digest}`;
  };
  const { composeAsset, manifest } = buildPersonalRelease({ compose, installer, version, api, caddy, pinImage });
  mkdirSync(outputPath, { recursive: true });
  writeFileSync(join(outputPath, composeFile), composeAsset);
  writeFileSync(join(outputPath, installerFile), installer);
  writeFileSync(join(outputPath, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
}
