import { createLogger } from '@/shared/log';

const log = createLogger('room:screen-startup');

/** The small, instance-local SDK boundary used by LiveKit 2.22.4. */
interface PublisherTransport {
  getLocalDescription(): { sdp: string } | null | undefined;
  getRemoteDescription(): { sdp: string } | null;
  setRemoteDescription: (
    this: PublisherTransport,
    description: RTCSessionDescriptionInit,
    offerId: number
  ) => Promise<boolean>;
}

const prepared = new WeakMap<PublisherTransport, { trackId: string }>();

/**
 * libwebrtc reads sender startup bitrate from the REMOTE description. LiveKit
 * 2.22.4 puts it only in the offer, on the first codec variant (which the SFU
 * may reject). Preserve that SDK-computed hint on the negotiated screen codec.
 * No global prototype patch, bitrate floor, repeated probing or ICE restart.
 * A new transport after reconnect gets its own one-shot seed.
 */
export function prepareScreenStartBitrate(transport: PublisherTransport, trackId: string): void {
  const pending = prepared.get(transport);
  if (pending) {
    pending.trackId = trackId;
    return;
  }
  const screen = { trackId };
  prepared.set(transport, screen);
  const original = transport.setRemoteDescription;
  let applying = false;
  transport.setRemoteDescription = async function (description, offerId) {
    const sdp =
      !applying && description.type === 'answer' && description.sdp
        ? screenStartBitrateAnswer(transport.getLocalDescription()?.sdp ?? '', description.sdp, screen.trackId)
        : undefined;
    if (!sdp) {
      const accepted = await original.call(this, description, offerId);
      // An SDK/server that already supplies the seed needs no later repair.
      if (
        accepted &&
        description.type === 'answer' &&
        videoSections(description.sdp ?? '').some((section) => /\bx-google-start-bitrate=/.test(section))
      )
        transport.setRemoteDescription = original;
      return accepted;
    }
    applying = true;
    const previousRemoteSdp = transport.getRemoteDescription()?.sdp;
    try {
      const accepted = await original.call(this, { ...description, sdp }, offerId);
      // Stale/duplicate answers return false; only consume an accepted answer.
      if (accepted) {
        transport.setRemoteDescription = original;
        log.info('screen startup bitrate hint applied');
      }
      return accepted;
    } catch (error) {
      // An unsupported hint must not prevent joining/publishing. Do not retry
      // this optimization on later negotiations, and never log raw SDP.
      transport.setRemoteDescription = original;
      // The SDK can reject AFTER accepting the answer (e.g. a queued next
      // negotiation fails). Retrying would be ignored as a duplicate and hide
      // that real error. Only retry an unchanged remote description.
      if (transport.getRemoteDescription()?.sdp !== previousRemoteSdp) throw error;
      log.warn('screen startup bitrate hint rejected; using original answer');
      return await original.call(this, description, offerId);
    } finally {
      applying = false;
    }
  };
}

function videoSections(sdp: string): string[] {
  return sdp.split(/(?=^m=)/m).filter((section) => /^m=video [1-9]\d* /m.test(section));
}

function codecs(section: string): Map<string, string> {
  return new Map(
    [...section.matchAll(/^a=rtpmap:(\d+) ([^/\s]+)\//gm)].map((match) => [
      match[1] ?? '',
      (match[2] ?? '').toLowerCase()
    ])
  );
}

/** Narrow SDP repair: a published screen's hint, on the codec accepted for that MID. */
export function screenStartBitrateAnswer(offer: string, answer: string, trackId: string): string | undefined {
  if (!trackId) return undefined;
  const screen = videoSections(offer).find(
    (section) =>
      /^a=(sendonly|sendrecv)\r?$/m.test(section) &&
      [...section.matchAll(/^a=msid:\S+ (\S+)/gm)].some((match) => match[1] === trackId)
  );
  if (!screen) return undefined;
  const mid = screen.match(/^a=mid:(\S+)/m)?.[1];
  const remote = videoSections(answer).find(
    (section) => section.match(/^a=mid:(\S+)/m)?.[1] === mid && /^a=(recvonly|sendrecv)\r?$/m.test(section)
  );
  if (!mid || !remote) return undefined;
  const offeredCodecs = codecs(screen);
  const acceptedCodecs = new Set(codecs(remote).values());
  let codec: string | undefined;
  let bitrate: string | undefined;
  for (const match of screen.matchAll(/^a=fmtp:(\d+) [^\r\n]*?\bx-google-start-bitrate=(\d+)(?:;|\s|$)/gm)) {
    const candidate = offeredCodecs.get(match[1] ?? '');
    // The hint is an initial estimate only; preserve SDK limits rather than
    // manufacturing a min/max bitrate. Reject malformed/non-video values.
    if (
      candidate &&
      ['h264', 'vp8', 'vp9', 'av1'].includes(candidate) &&
      acceptedCodecs.has(candidate) &&
      Number.isSafeInteger(Number(match[2])) &&
      Number(match[2]) > 0
    ) {
      codec = candidate;
      bitrate = match[2];
      break;
    }
  }
  if (!codec || !bitrate) return undefined;
  // An upstream/server-provided hint wins; this shim is only for a missing hint.
  if (/\bx-google-start-bitrate=/.test(remote)) return undefined;
  const payloads = new Set([...codecs(remote)].filter(([, name]) => name === codec).map(([payload]) => payload));
  const newline = answer.includes('\r\n') ? '\r\n' : '\n';
  // Shared payload types must have identical fmtp in BUNDLE placeholders too.
  return answer
    .split(/(?=^m=)/m)
    .map((section) => {
      if (!section.startsWith('m=video')) return section;
      const sectionCodecs = codecs(section);
      for (const payload of payloads) {
        if (sectionCodecs.get(payload) !== codec) continue;
        const prefix = `a=fmtp:${payload} `;
        const lines = section.split(newline);
        const index = lines.findIndex((line) => line.startsWith(prefix));
        if (index >= 0) {
          const line = lines[index];
          if (line !== undefined && !line.includes('x-google-start-bitrate=')) {
            lines[index] = `${line};x-google-start-bitrate=${bitrate}`;
          }
        } else {
          const rtp = lines.findIndex((line) => line.startsWith(`a=rtpmap:${payload} `));
          lines.splice(rtp + 1, 0, `${prefix}x-google-start-bitrate=${bitrate}`);
        }
        section = lines.join(newline);
      }
      return section;
    })
    .join('');
}
