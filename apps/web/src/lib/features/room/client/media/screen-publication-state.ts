export interface ScreenPublicationPresence {
  active: boolean;
  hasAudio: boolean;
  hasVideo: boolean;
}

export function getScreenPublicationPresence<T>(
  publications: Iterable<T>,
  isVideo: (publication: T) => boolean,
  isAudio: (publication: T) => boolean
): ScreenPublicationPresence {
  let hasAudio = false;
  let hasVideo = false;
  for (const publication of publications) {
    if (isVideo(publication)) hasVideo = true;
    if (isAudio(publication)) hasAudio = true;
  }
  return {
    active: hasVideo || hasAudio,
    hasAudio,
    hasVideo
  };
}
