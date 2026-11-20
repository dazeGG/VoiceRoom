import { voiceAssetUrls, type VoiceAssetUrls } from '@voice-room/call/voice-assets';

/** Defined by Vite from the content hash of the files emitted by this build. */
declare const __VOICE_ASSET_URLS__: VoiceAssetUrls;

export const voiceAssets = import.meta.env.PROD ? __VOICE_ASSET_URLS__ : voiceAssetUrls();

/** What opening the microphone loads, one file after another, unless already cached. */
export const MICROPHONE_ASSET_URLS = [
  voiceAssets.rnnoiseModule,
  voiceAssets.rnnoiseWasm,
  voiceAssets.rnnoiseWorklet,
  voiceAssets.audioGateWorklet
];
