import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { isRecord } from '../../packages/shared/src/guards.ts';
import { buildPersonalRelease } from '../cd/build-personal-release.mts';

const apiService = { image: '${COMPOSE_PROJECT_NAME}-api', build: { context: '.', target: 'api' } };
const environment = { PERSONAL_ORIGIN: '${PERSONAL_ORIGIN:-https://${PERSONAL_DOMAIN}}' };
const volumes = { owner: null, postgres: null };
const compose = {
  name: 'voiceroom-personal',
  services: {
    api: { ...apiService, environment },
    migrate: apiService,
    'livekit-gate': apiService,
    caddy: { build: { context: '.', target: 'personal-web' } },
    postgres: { image: 'postgres' },
    livekit: { image: 'livekit/livekit-server' }
  },
  volumes,
  'x-api-image': apiService
};
const installer = Buffer.from('#!/bin/sh\nexit 0\n');
const version = 'meet/v1.0.0';
const api = pinImage('ghcr.io/dazegg/voiceroom-api');
const caddy = pinImage('ghcr.io/dazegg/voiceroom-web');

function sha256(bytes: string | Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function pinImage(image: string): string {
  return `${image}@sha256:${sha256(image)}`;
}

test('the installer manifest binds the emitted Compose and installer to the immutable images', () => {
  const { composeAsset, manifest } = buildPersonalRelease({ compose, installer, version, api, caddy, pinImage });
  assert.deepEqual(manifest, {
    schemaVersion: 1,
    version,
    files: { 'docker-compose.personal.yml': sha256(composeAsset), 'install.sh': sha256(installer) },
    images: {
      api,
      caddy,
      postgres: pinImage('postgres'),
      livekit: pinImage('livekit/livekit-server')
    }
  });
  const asset: unknown = JSON.parse(composeAsset);
  assert.ok(isRecord(asset) && isRecord(asset.services));
  for (const [service, image] of Object.entries({
    ...manifest.images,
    migrate: manifest.images.api,
    'livekit-gate': manifest.images.api
  })) {
    const config: unknown = asset.services[service];
    assert.ok(isRecord(config));
    assert.equal(config.image, image);
    assert.ok(!Object.hasOwn(config, 'build'));
  }
  assert.deepEqual(asset.services.api, { image: manifest.images.api, environment });
  assert.deepEqual(asset.volumes, volumes);
  assert.equal(asset.name, compose.name);
  assert.ok(!Object.hasOwn(asset, 'x-api-image'));
});

test('the bundle rejects unpinned images and unaccounted-for services', () => {
  assert.throws(
    () =>
      buildPersonalRelease({
        compose,
        installer,
        version,
        api: 'ghcr.io/dazegg/voiceroom-api:mutable',
        caddy,
        pinImage
      }),
    /immutable digest/
  );
  assert.throws(
    () => buildPersonalRelease({ compose, installer, version, api, caddy, pinImage: (image) => image }),
    /immutable digest/
  );
  const withWorker = { ...compose, services: { ...compose.services, worker: apiService } };
  assert.throws(
    () => buildPersonalRelease({ compose: withWorker, installer, version, api, caddy, pinImage }),
    /Unexpected personal Compose services/
  );
});

test('only a stable Meet tag can become a new installer manifest version', () => {
  for (const version of ['v2.15.0', 'api/v1.0.0', 'meet/v1.0.0-rc.1', 'meet/v01.0.0']) {
    assert.throws(
      () => buildPersonalRelease({ compose, installer, version, api, caddy, pinImage }),
      /stable Meet release tag/
    );
  }
});
