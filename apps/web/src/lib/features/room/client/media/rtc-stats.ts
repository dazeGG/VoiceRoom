// The one reader of a WebRTC stats report. lib.dom types the report's entries
// as `any`, so the fields the room uses are checked here once: each field is
// set only when the browser gave it the expected type, and undefined otherwise.

import { isRecord } from '@voice-room/shared/guards';

export interface RtcStat {
  readonly id: string;
  readonly type: string;
  readonly timestamp: number | undefined;
  // inbound-rtp, outbound-rtp, remote-inbound-rtp
  readonly kind: string | undefined;
  readonly mediaType: string | undefined;
  readonly codecId: string | undefined;
  readonly packetsLost: number | undefined;
  readonly packetsReceived: number | undefined;
  readonly packetsSent: number | undefined;
  /** inbound-rtp: packets that came too late to be played. */
  readonly packetsDiscarded: number | undefined;
  /** outbound-rtp: the source a simulcast layer encodes; its layers share it. */
  readonly mediaSourceId: string | undefined;
  // inbound-rtp audio: samples played, those made up for missing packets, and the made-up ones that were silence
  readonly totalSamplesReceived: number | undefined;
  readonly concealedSamples: number | undefined;
  readonly silentConcealedSamples: number | undefined;
  readonly jitter: number | undefined;
  readonly fractionLost: number | undefined;
  readonly roundTripTime: number | undefined;
  // outbound-rtp
  readonly isRemote: boolean | undefined;
  readonly bytesSent: number | undefined;
  readonly encoderImplementation: string | undefined;
  readonly firCount: number | undefined;
  readonly frameHeight: number | undefined;
  readonly framesDropped: number | undefined;
  readonly framesEncoded: number | undefined;
  readonly framesPerSecond: number | undefined;
  readonly framesSent: number | undefined;
  readonly frameWidth: number | undefined;
  readonly keyFramesEncoded: number | undefined;
  readonly nackCount: number | undefined;
  readonly pliCount: number | undefined;
  readonly qpSum: number | undefined;
  readonly qualityLimitationReason: string | undefined;
  /** Seconds the encoder has run, summed over qualityLimitationDurations, and those of them held back for CPU. */
  readonly qualityLimitationSeconds: number | undefined;
  readonly qualityLimitationCpuSeconds: number | undefined;
  // inbound-rtp video: frames that arrived (framesDropped above counts those never shown)
  readonly framesReceived: number | undefined;
  // candidate-pair
  readonly state: string | undefined;
  readonly nominated: boolean | undefined;
  /** Firefox's flag for the pair in use. */
  readonly selected: boolean | undefined;
  readonly currentRoundTripTime: number | undefined;
  /** Seconds summed over every check of the pair, and how many there were. */
  readonly totalRoundTripTime: number | undefined;
  readonly responsesReceived: number | undefined;
  readonly localCandidateId: string | undefined;
  readonly availableOutgoingBitrate: number | undefined;
  readonly estimatedOutgoingBitrate: number | undefined;
  // local-candidate
  readonly candidateType: string | undefined;
  readonly protocol: string | undefined;
  // codec
  readonly mimeType: string | undefined;
  readonly mime: string | undefined;
}

/** What reading a report needs: RTCStatsReport, or a stand-in that walks its entries. */
export type RtcStatsSource = { forEach(callback: (value: unknown) => void): void };

/** The report's entries by id; empty when there is no report. */
export function readRtcStats(report: RtcStatsSource | null | undefined): Map<string, RtcStat> {
  const stats = new Map<string, RtcStat>();
  report?.forEach((value: unknown) => {
    const stat = toRtcStat(value);
    if (stat) stats.set(stat.id, stat);
  });
  return stats;
}

function toRtcStat(value: unknown): RtcStat | null {
  if (!isRecord(value) || typeof value.id !== 'string') return null;
  const number = (key: string): number | undefined => {
    const field = value[key];
    return typeof field === 'number' ? field : undefined;
  };
  const string = (key: string): string | undefined => {
    const field = value[key];
    return typeof field === 'string' ? field : undefined;
  };
  const durations = isRecord(value.qualityLimitationDurations) ? value.qualityLimitationDurations : null;
  const durationSeconds = (field: unknown): number => (typeof field === 'number' && field > 0 ? field : 0);
  const boolean = (key: string): boolean | undefined => {
    const field = value[key];
    return typeof field === 'boolean' ? field : undefined;
  };
  return {
    availableOutgoingBitrate: number('availableOutgoingBitrate'),
    bytesSent: number('bytesSent'),
    candidateType: string('candidateType'),
    codecId: string('codecId'),
    currentRoundTripTime: number('currentRoundTripTime'),
    encoderImplementation: string('encoderImplementation'),
    estimatedOutgoingBitrate: number('estimatedOutgoingBitrate'),
    firCount: number('firCount'),
    fractionLost: number('fractionLost'),
    frameHeight: number('frameHeight'),
    frameWidth: number('frameWidth'),
    framesDropped: number('framesDropped'),
    framesEncoded: number('framesEncoded'),
    framesPerSecond: number('framesPerSecond'),
    framesReceived: number('framesReceived'),
    framesSent: number('framesSent'),
    id: value.id,
    isRemote: boolean('isRemote'),
    jitter: number('jitter'),
    keyFramesEncoded: number('keyFramesEncoded'),
    kind: string('kind'),
    localCandidateId: string('localCandidateId'),
    mediaSourceId: string('mediaSourceId'),
    mediaType: string('mediaType'),
    mime: string('mime'),
    mimeType: string('mimeType'),
    nackCount: number('nackCount'),
    nominated: boolean('nominated'),
    packetsDiscarded: number('packetsDiscarded'),
    packetsLost: number('packetsLost'),
    packetsReceived: number('packetsReceived'),
    packetsSent: number('packetsSent'),
    totalSamplesReceived: number('totalSamplesReceived'),
    concealedSamples: number('concealedSamples'),
    silentConcealedSamples: number('silentConcealedSamples'),
    totalRoundTripTime: number('totalRoundTripTime'),
    responsesReceived: number('responsesReceived'),
    pliCount: number('pliCount'),
    protocol: string('protocol'),
    qpSum: number('qpSum'),
    qualityLimitationReason: string('qualityLimitationReason'),
    qualityLimitationSeconds: durations
      ? Object.values(durations).reduce<number>((sum, field) => sum + durationSeconds(field), 0)
      : undefined,
    qualityLimitationCpuSeconds: durations ? durationSeconds(durations.cpu) : undefined,
    roundTripTime: number('roundTripTime'),
    selected: boolean('selected'),
    state: string('state'),
    timestamp: number('timestamp'),
    type: string('type') ?? ''
  };
}

/** The candidate pair in use: Chrome flags it `nominated`, Firefox `selected`. */
export function isActiveCandidatePair(report: RtcStat): boolean {
  return (
    report.type === 'candidate-pair' && report.state === 'succeeded' && Boolean(report.nominated || report.selected)
  );
}
