// Property order also defines the order of the bytes in the deployment hash.
export const voiceAssetPaths = {
  audioGateWorklet: '/audio-gate.worklet.js',
  desktopAudioSourceWorklet: '/desktop-audio-source.worklet.js',
  rnnoiseModule: '/rnnoise/rnnoise.mjs',
  rnnoiseWasm: '/rnnoise/rnnoise.wasm',
  rnnoiseWorklet: '/rnnoise/rnnoise.worklet.js'
} as const;

export const voiceAssetLicensePath = '/rnnoise/LICENSE';

export type VoiceAssetUrls = Readonly<Record<keyof typeof voiceAssetPaths, string>>;

/** Caddy caches these fixed paths for a year when the URL carries a content hash. */
export function voiceAssetUrls(version = ''): VoiceAssetUrls {
  const query = version ? `?v=${version}` : '';
  return {
    audioGateWorklet: voiceAssetPaths.audioGateWorklet + query,
    desktopAudioSourceWorklet: voiceAssetPaths.desktopAudioSourceWorklet + query,
    rnnoiseModule: voiceAssetPaths.rnnoiseModule + query,
    rnnoiseWasm: voiceAssetPaths.rnnoiseWasm + query,
    rnnoiseWorklet: voiceAssetPaths.rnnoiseWorklet + query
  };
}
