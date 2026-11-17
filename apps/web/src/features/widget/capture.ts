import { createRnnoiseNode } from '../room/client/media/rnnoise-node';
export type WidgetNoiseMode = 'rnnoise' | 'browser' | 'off';
export interface WidgetCapture {
  track: MediaStreamTrack;
  dispose(): void;
}
/** Each frame owns capture and processing; no account, storage or room singleton. */
export async function openWidgetMicrophone(
  deviceId: string,
  mode: WidgetNoiseMode,
  onProcessorError: () => void
): Promise<WidgetCapture> {
  const raw = await navigator.mediaDevices.getUserMedia({
    audio: {
      ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
      echoCancellation: true,
      noiseSuppression: mode === 'browser',
      autoGainControl: true
    }
  });
  let context: AudioContext | undefined;
  let node: AudioNode | undefined;
  try {
    if (mode !== 'rnnoise') {
      const track = raw.getAudioTracks()[0];
      if (!track) throw new Error('Микрофон недоступен');
      return { track, dispose: () => raw.getTracks().forEach((item) => item.stop()) };
    }
    context = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' });
    const source = context.createMediaStreamSource(raw);
    const output = context.createMediaStreamDestination();
    node = await createRnnoiseNode(context, (processor) =>
      processor.addEventListener('processorerror', onProcessorError, { once: true })
    );
    source.connect(node);
    node.connect(output);
    await context.resume();
    const track = output.stream.getAudioTracks()[0];
    if (!track) throw new Error('Шумоподавление недоступно');
    const processing = context;
    const processor = node;
    return {
      track,
      dispose: () => {
        processor.removeEventListener('processorerror', onProcessorError);
        processor.disconnect();
        source.disconnect();
        raw.getTracks().forEach((item) => item.stop());
        output.stream.getTracks().forEach((item) => item.stop());
        void processing.close();
      }
    };
  } catch (error) {
    raw.getTracks().forEach((item) => item.stop());
    node?.disconnect();
    if (context) void context.close();
    throw error;
  }
}
