// Safari on iPhone can lay a starting camera out by a stale size and draw it
// small in the middle of its box, with dark bars around it, until the box
// itself changes size (WebKit bug 275210). Nothing tells the page when Safari
// gets it wrong, so the picture is nudged a pixel wider and back on its first
// frames and whenever it changes size; Safari then lays it out again. It is
// kept hidden until the first nudge, so the wrong size is never seen.

/** Frames after the start on which the picture is nudged: early, then less often. */
const NUDGE_FRAMES = new Set([1, 2, 4, 8, 16, 32, 64]);
/** Without frame callbacks the nudges run on a timer after the picture starts. */
const NUDGE_DELAYS_MS = [0, 100, 300, 700, 1500, 3000];
/** A picture that never reports a frame is shown anyway. */
const REVEAL_LIMIT_MS = 1500;

type FrameCallbackVideo = HTMLVideoElement & {
  requestVideoFrameCallback?: (callback: () => void) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
};

export function keepVideoFitted(element: HTMLVideoElement): () => void {
  const video = element as FrameCallbackVideo;
  let started = false;
  let frameCount = 0;
  let frameHandle = 0;
  let nudgeFrame = 0;
  const timers: number[] = [];

  video.style.opacity = '0';
  const reveal = (): void => {
    video.style.opacity = '';
  };

  // Two painted frames at the new width: Safari lays the picture out at its
  // real size, and the extra pixel is clipped by the tile.
  const nudge = (): void => {
    cancelAnimationFrame(nudgeFrame);
    video.style.width = 'calc(100% + 1px)';
    nudgeFrame = requestAnimationFrame(() => {
      nudgeFrame = requestAnimationFrame(() => {
        video.style.width = '';
        reveal();
      });
    });
  };

  const onFrame = (): void => {
    frameCount += 1;
    if (NUDGE_FRAMES.has(frameCount)) nudge();
    if (frameCount < 64) frameHandle = video.requestVideoFrameCallback(onFrame);
  };

  const onStart = (): void => {
    if (started) return;
    started = true;
    if (typeof video.requestVideoFrameCallback === 'function') frameHandle = video.requestVideoFrameCallback(onFrame);
    else for (const delay of NUDGE_DELAYS_MS) timers.push(window.setTimeout(nudge, delay));
  };

  video.addEventListener('loadedmetadata', onStart);
  video.addEventListener('playing', onStart);
  video.addEventListener('resize', nudge);
  timers.push(window.setTimeout(reveal, REVEAL_LIMIT_MS));

  return () => {
    cancelAnimationFrame(nudgeFrame);
    if (frameHandle) video.cancelVideoFrameCallback?.(frameHandle);
    for (const timer of timers) window.clearTimeout(timer);
    video.removeEventListener('loadedmetadata', onStart);
    video.removeEventListener('playing', onStart);
    video.removeEventListener('resize', nudge);
    video.style.width = '';
    video.style.opacity = '';
  };
}
