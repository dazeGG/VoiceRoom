import { t } from '@/shared/i18n';
import { isRecord } from '@voice-room/shared/guards';
import { RNNOISE_ASSET_BASE, RNNOISE_MODULE_URL, RNNOISE_WASM_URL, RNNOISE_WORKLET_URL } from '../core/config';
/** What the RNNoise asset module (a static file without typings) exports. */
interface RnnoiseModule {
  RNNoiseNode: {
    register(context: BaseAudioContext, assets: unknown): Promise<void>;
    new (context: BaseAudioContext): AudioWorkletNode;
  };
  rnnoise_loadAssets: (options: { moduleSrc: string; scriptSrc: string }) => unknown;
}

let rnnoiseModulePromise: Promise<RnnoiseModule> | null = null;
export async function createRnnoiseNode(
  context: AudioContext,
  onCreated: (node: AudioNode) => void
): Promise<AudioNode> {
  if (!window.AudioWorkletNode || !context.audioWorklet) {
    throw new Error(t('AudioWorklet недоступен'));
  }
  const { RNNoiseNode, rnnoise_loadAssets: loadAssets } = await loadRnnoiseModule();
  await RNNoiseNode.register(
    context,
    loadAssets({
      moduleSrc: RNNOISE_WASM_URL,
      scriptSrc: RNNOISE_WORKLET_URL
    })
  );
  const node = new RNNoiseNode(context);
  onCreated(node);
  return node;
}

function importRnnoiseModule(): Promise<unknown> {
  // The dev server adds ?import to any address it cannot read as a .mjs file, then
  // refuses a file of public/ asked for that way and covers the page with an error.
  if (import.meta.env.DEV) return import(/* @vite-ignore */ `${RNNOISE_ASSET_BASE}rnnoise.mjs`);
  return import(/* @vite-ignore */ RNNOISE_MODULE_URL);
}

function loadRnnoiseModule(): Promise<RnnoiseModule> {
  rnnoiseModulePromise ||= importRnnoiseModule().then((module: unknown) => {
    if (!isRnnoiseModule(module)) throw new Error('RNNoise module has an unexpected shape');
    return module;
  });
  return rnnoiseModulePromise;
}

function isRnnoiseModule(value: unknown): value is RnnoiseModule {
  return isRecord(value) && typeof value.RNNoiseNode === 'function' && typeof value.rnnoise_loadAssets === 'function';
}
