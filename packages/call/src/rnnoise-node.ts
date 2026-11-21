import { isRecord } from '@voiceroom/shared/guards';
import type { VoiceAssetUrls } from './voice-assets';

/** What the RNNoise asset module (a static file without typings) exports. */
interface RnnoiseModule {
  RNNoiseNode: {
    register(context: BaseAudioContext, assets: unknown): Promise<void>;
    new (context: BaseAudioContext): AudioWorkletNode;
  };
  rnnoise_loadAssets: (options: { moduleSrc: string; scriptSrc: string }) => unknown;
}

type RnnoiseUrls = Pick<VoiceAssetUrls, 'rnnoiseModule' | 'rnnoiseWasm' | 'rnnoiseWorklet'>;

const rnnoiseModules = new Map<string, Promise<RnnoiseModule>>();

export async function createRnnoiseNode(
  context: AudioContext,
  onCreated: (node: AudioNode) => void,
  urls: RnnoiseUrls,
  workletUnavailable: () => string
): Promise<AudioNode> {
  if (!window.AudioWorkletNode || !context.audioWorklet) {
    throw new Error(workletUnavailable());
  }
  const { RNNoiseNode, rnnoise_loadAssets: loadAssets } = await loadRnnoiseModule(urls.rnnoiseModule);
  await RNNoiseNode.register(context, loadAssets({ moduleSrc: urls.rnnoiseWasm, scriptSrc: urls.rnnoiseWorklet }));
  const node = new RNNoiseNode(context);
  onCreated(node);
  return node;
}

function loadRnnoiseModule(url: string): Promise<RnnoiseModule> {
  const existing = rnnoiseModules.get(url);
  if (existing) return existing;
  const loading = import(/* @vite-ignore */ url).then((module: unknown) => {
    if (!isRnnoiseModule(module)) throw new Error('RNNoise module has an unexpected shape');
    return module;
  });
  rnnoiseModules.set(url, loading);
  return loading;
}

function isRnnoiseModule(value: unknown): value is RnnoiseModule {
  return isRecord(value) && typeof value.RNNoiseNode === 'function' && typeof value.rnnoise_loadAssets === 'function';
}
