// Safari on iPhone can keep drawing a camera at the size of its first frames,
// small in the middle of its box with dark bars around it, until the box
// changes size (WebKit bug 275210). Whenever the picture starts or changes
// size, its fit is flipped for a couple of frames so Safari lays it out again.

export function keepVideoFitted(video: HTMLVideoElement): () => void {
  let frame = 0;
  const refit = (): void => {
    cancelAnimationFrame(frame);
    video.style.objectFit = 'fill';
    frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        video.style.objectFit = '';
      });
    });
  };
  const events = ['loadedmetadata', 'playing', 'resize'] as const;
  for (const type of events) video.addEventListener(type, refit);
  return () => {
    cancelAnimationFrame(frame);
    for (const type of events) video.removeEventListener(type, refit);
    video.style.objectFit = '';
  };
}
