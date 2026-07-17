const playbackPolicy = $state({ doNotDisturb: false });

export function setDoNotDisturbPlaybackSuppressed(suppressed: boolean): void {
  playbackPolicy.doNotDisturb = Boolean(suppressed);
}

export function isDoNotDisturbPlaybackSuppressed(): boolean {
  return playbackPolicy.doNotDisturb;
}
