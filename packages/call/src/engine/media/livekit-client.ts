export {
  BaseKeyProvider,
  ConnectionState,
  createKeyMaterialFromBuffer,
  getBrowser,
  Room,
  RoomEvent,
  setLogLevel,
  SubscriptionError,
  Track,
  VideoPreset,
  VideoPresets,
  VideoQuality
} from 'livekit-client';

/** The SDK's frame-encryption worker, bundled by the host's build and loaded only when an E2EE call room starts one. */
export async function createE2eeWorker(): Promise<Worker> {
  const { default: E2eeWorker } = await import('livekit-client/e2ee-worker?worker');
  return new E2eeWorker();
}
