// An isolated localhost two-generation serving root. The real pinned loader,
// WASM and worklet bytes execute in Chromium without app/SW background loads.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';

declare global {
  interface Window {
    RNNoiseNodeTest?: {
      new (context: BaseAudioContext): AudioWorkletNode & { update(keepalive?: boolean): void };
      register(context: BaseAudioContext, assets: [string, Promise<WebAssembly.Module>]): Promise<void>;
      ready: boolean;
      scriptSrc: string | null;
      module: WebAssembly.Module | null;
    };
    RNNoisePinnedModule?: WebAssembly.Module;
  }
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const oldWorklet = readFileSync(join(root, 'test/fixtures/rnnoise-old.worklet.js.txt'));
const newWorklet = readFileSync(join(root, 'public/rnnoise/rnnoise.worklet.js'));
const loader = readFileSync(join(root, 'public/rnnoise/rnnoise.mjs'));
const wasm = readFileSync(join(root, 'public/rnnoise/rnnoise.wasm'));
const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

async function startServingRoot() {
  const servedWorklets: Array<{ slot: string; hash: string }> = [];
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    const finish = (status: number, type: string, bytes: Buffer | string) => {
      response.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'public, max-age=31536000, immutable' });
      response.end(bytes);
    };
    if (url.pathname === '/') {
      finish(200, 'text/html', '<!doctype html><title>RNNoise fixture</title>');
      return;
    }
    if (url.pathname === '/rnnoise/rnnoise.mjs') {
      finish(200, 'text/javascript', loader);
      return;
    }
    if (url.pathname === '/rnnoise/rnnoise.wasm') {
      finish(200, 'application/wasm', wasm);
      return;
    }
    if (url.pathname === '/rnnoise/test-loader.js') {
      finish(
        200,
        'text/javascript',
        "import { RNNoiseNode } from '/rnnoise/rnnoise.mjs'; window.RNNoiseNodeTest = RNNoiseNode;"
      );
      return;
    }
    if (url.pathname === '/rnnoise/rnnoise.worklet.js') {
      const slot = url.searchParams.get('slot') ?? '';
      if (slot === 'missing') {
        servedWorklets.push({ slot, hash: 'missing' });
        finish(404, 'text/javascript', '');
        return;
      }
      const bytes = slot === 'cold-new' || slot === 'new' ? newWorklet : oldWorklet;
      servedWorklets.push({ slot, hash: sha256(bytes) });
      finish(200, 'text/javascript', bytes);
      return;
    }
    finish(404, 'text/plain', 'missing');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Asset fixture has no TCP address');
  return {
    origin: `http://127.0.0.1:${address.port}`,
    servedWorklets,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  };
}

async function loadPinnedLoader(page: Page, origin: string): Promise<void> {
  await page.goto(origin);
  await page.addScriptTag({ type: 'module', url: `${origin}/rnnoise/test-loader.js` });
  await page.waitForFunction(() => Boolean(window.RNNoiseNodeTest));
}

const expectedOld = '36208641d215d6b06a193a9e0351ca345ea78e20b76f828773a1ea26863b13cc';
const expectedNew = '44cacadc74d8b0c0d3c07c75a59ea2ca8d117dcdd13e2607c9696e35be57c553';

test('old/new page-version queries load old/new worklets with actual pinned loader and WASM', async ({ browser }) => {
  assert.equal(sha256(oldWorklet), expectedOld);
  assert.equal(sha256(newWorklet), expectedNew);
  assert.equal(sha256(loader), 'ed30ea3f71c9e4c43498afc8fe442e8165ca94df3eaf3ddbf4e83d4581ce4256');
  assert.equal(sha256(wasm), 'd35096e542660d140c5fca130c3789ee48baef124d186e69f536efcaf6c1cf94');
  const fixture = await startServingRoot();
  try {
    for (const pageVersion of ['old', 'new']) {
      for (const slot of ['old', 'new']) {
        const context = await browser.newContext();
        try {
          const page = await context.newPage();
          await loadPinnedLoader(page, fixture.origin);
          const result = await page.evaluate(
            async ({ pageVersion, slot }) => {
              const RNNoiseNode = window.RNNoiseNodeTest;
              if (!RNNoiseNode) throw new Error('RNNoise loader did not register');
              const module = await WebAssembly.compile(await (await fetch('/rnnoise/rnnoise.wasm')).arrayBuffer());
              const context = new OfflineAudioContext(1, 4096, 48_000);
              await RNNoiseNode.register(context, [
                `/rnnoise/rnnoise.worklet.js?v=${pageVersion}&slot=${slot}`,
                Promise.resolve(module)
              ]);
              const processor = new RNNoiseNode(context);
              let errors = 0;
              processor.addEventListener('processorerror', () => errors++);
              const source = new ConstantSourceNode(context, { offset: 0.2 });
              source.connect(processor).connect(context.destination);
              source.start();
              const rendered = await context.startRendering();
              processor.update(false);
              return { errors, finite: rendered.getChannelData(0).every(Number.isFinite) };
            },
            { pageVersion, slot }
          );
          expect(result).toEqual({ errors: 0, finite: true });
        } finally {
          await context.close();
        }
      }
    }
    expect(fixture.servedWorklets.map((entry) => entry.hash)).toEqual([
      expectedOld,
      expectedNew,
      expectedOld,
      expectedNew
    ]);
  } finally {
    await fixture.close();
  }
});

test('warm old page retains its old worklet across fresh contexts', async ({ page }) => {
  const fixture = await startServingRoot();
  try {
    await loadPinnedLoader(page, fixture.origin);
    const run = () =>
      page.evaluate(async () => {
        const RNNoiseNode = window.RNNoiseNodeTest;
        if (!RNNoiseNode) throw new Error('RNNoise loader did not register');
        const module =
          window.RNNoisePinnedModule ??
          (await WebAssembly.compile(await (await fetch('/rnnoise/rnnoise.wasm')).arrayBuffer()));
        window.RNNoisePinnedModule = module;
        const context = new OfflineAudioContext(1, 1024, 48_000);
        await RNNoiseNode.register(context, ['/rnnoise/rnnoise.worklet.js?v=old&slot=old', Promise.resolve(module)]);
        const processor = new RNNoiseNode(context);
        const source = new ConstantSourceNode(context, { offset: 0.2 });
        source.connect(processor).connect(context.destination);
        source.start();
        await context.startRendering();
        processor.update(false);
        return RNNoiseNode.module === module;
      });
    expect(await run()).toBe(true);
    expect(await run()).toBe(true);
    expect(fixture.servedWorklets).toEqual([{ slot: 'old', hash: expectedOld }]);
  } finally {
    await fixture.close();
  }
});

test('old loader/compiled WASM survive cold new worklet fetch, rollback and missing asset', async ({ page }) => {
  const fixture = await startServingRoot();
  try {
    await loadPinnedLoader(page, fixture.origin);
    const run = (slot: string) =>
      page.evaluate(async (slot) => {
        const RNNoiseNode = window.RNNoiseNodeTest;
        if (!RNNoiseNode) throw new Error('RNNoise loader did not register');
        const module =
          window.RNNoisePinnedModule ??
          (await WebAssembly.compile(await (await fetch('/rnnoise/rnnoise.wasm')).arrayBuffer()));
        window.RNNoisePinnedModule = module;
        const context = new OfflineAudioContext(1, 4096, 48_000);
        const url = `/rnnoise/rnnoise.worklet.js?v=old-page&slot=${slot}`;
        // Test-only cache-miss seam. Retain the loader object and compiled WASM;
        // make just the next worklet URL cold by appending a unique slot.
        if (RNNoiseNode.ready) RNNoiseNode.scriptSrc = url;
        try {
          await RNNoiseNode.register(context, [url, Promise.resolve(module)]);
        } catch {
          return { registered: false, sameModule: RNNoiseNode.module === module, errors: 0 };
        }
        const processor = new RNNoiseNode(context);
        let errors = 0;
        processor.addEventListener('processorerror', () => errors++);
        const source = new ConstantSourceNode(context, { offset: 0.2 });
        source.connect(processor).connect(context.destination);
        source.start();
        const rendered = await context.startRendering();
        processor.update(false);
        return {
          registered: true,
          sameModule: RNNoiseNode.module === module,
          errors,
          finite: rendered.getChannelData(0).every(Number.isFinite)
        };
      }, slot);
    expect(await run('old')).toEqual({ registered: true, sameModule: true, errors: 0, finite: true });
    expect(await run('cold-new')).toEqual({ registered: true, sameModule: true, errors: 0, finite: true });
    expect(await run('rollback-old')).toEqual({ registered: true, sameModule: true, errors: 0, finite: true });
    expect(await run('missing')).toEqual({ registered: false, sameModule: true, errors: 0 });
    expect(fixture.servedWorklets).toEqual([
      { slot: 'old', hash: expectedOld },
      { slot: 'cold-new', hash: expectedNew },
      { slot: 'rollback-old', hash: expectedOld },
      { slot: 'missing', hash: 'missing' }
    ]);
  } finally {
    await fixture.close();
  }
});

test('new worklet emits zero with no active input channel', async ({ page }) => {
  const fixture = await startServingRoot();
  try {
    await page.goto(fixture.origin);
    const result = await page.evaluate(async () => {
      const module = await WebAssembly.compile(await (await fetch('/rnnoise/rnnoise.wasm')).arrayBuffer());
      const context = new OfflineAudioContext(1, 1024, 48_000);
      await context.audioWorklet.addModule('/rnnoise/rnnoise.worklet.js?v=new&slot=new');
      const processor = new AudioWorkletNode(context, 'rnnoise', { processorOptions: { module } });
      let errors = 0;
      processor.addEventListener('processorerror', () => errors++);
      processor.connect(context.destination);
      const rendered = await context.startRendering();
      return { errors, silent: rendered.getChannelData(0).every((sample) => sample === 0) };
    });
    expect(result).toEqual({ errors: 0, silent: true });
    expect(fixture.servedWorklets).toEqual([{ slot: 'new', hash: expectedNew }]);
  } finally {
    await fixture.close();
  }
});
