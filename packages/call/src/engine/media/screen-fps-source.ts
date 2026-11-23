/** Which frame rate a screen-share observer judges a publication by. */
export type ScreenFpsSource = 'sent' | 'rendered' | 'decoded';

/**
 * Firefox counts no playback frames for a MediaStream video that is playing, so a
 * viewer whose counter has never counted a frame is measured by decoded FPS. Once
 * the counter has counted one, rendered FPS is the measure, so a stage that
 * decodes but does not paint still reads as zero.
 */
export function playbackCounted(playback: { totalVideoFrames: number } | undefined): boolean {
  return (playback?.totalVideoFrames ?? 0) > 0;
}

export function screenFpsSource(direction: 'send' | 'receive', playbackCounts: boolean): ScreenFpsSource {
  if (direction === 'send') return 'sent';
  return playbackCounts ? 'rendered' : 'decoded';
}
