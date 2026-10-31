// LiveKit reports a "silent" microphone by sampling the published track right
// after it goes out. Ours is the processed one: the gate and the silence floor
// turn a quiet room into exact digital zero on purpose, so that check fires
// every time someone joins without talking. A microphone that really delivers
// nothing (muted in the OS, a dead device) is silent before the processing too,
// so the raw capture track is what tells the two apart.

const SAMPLE_MS = 1_000;

/** True only when the track gave exact zeros for the whole sample. */
export async function isMicrophoneInputSilent(track: MediaStreamTrack, sampleMs = SAMPLE_MS): Promise<boolean> {
  if (track.readyState !== 'live' || typeof AudioContext !== 'function') return false;
  const context = new AudioContext();
  try {
    await context.resume().catch(() => {});
    // A context the page may not start yet hears nothing: that says nothing
    // about the microphone.
    if (context.state !== 'running') return false;
    const analyser = context.createAnalyser();
    analyser.fftSize = 2048;
    context.createMediaStreamSource(new MediaStream([track])).connect(analyser);
    const samples = new Float32Array(analyser.fftSize);
    const deadline = Date.now() + sampleMs;
    do {
      await new Promise((resolve) => setTimeout(resolve, Math.min(100, sampleMs)));
      analyser.getFloatTimeDomainData(samples);
      if (samples.some((sample) => sample !== 0)) return false;
    } while (Date.now() < deadline);
    return true;
  } finally {
    context.close().catch(() => {});
  }
}
