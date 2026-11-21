import { voiceAssetUrls, type VoiceAssetUrls } from '@voiceroom/call/voice-assets';

/** Defined by Vite from the content hash of the files emitted by this build. */
declare const __VOICE_ASSET_URLS__: VoiceAssetUrls;

export const voiceAssets = import.meta.env.PROD ? __VOICE_ASSET_URLS__ : voiceAssetUrls();
