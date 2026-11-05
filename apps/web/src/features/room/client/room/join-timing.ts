// How long this join takes, stage by stage. Sent once with the first stats poll,
// so the server keeps what real people on real lines wait: a test bench has
// neither their microphone nor their route.

import type { JoinTiming } from '@voice-room/shared/contracts/realtime';

type JoinStage = keyof JoinTiming;

let startedAt: number | null = null;
let stages: Partial<JoinTiming> = {};
let finished: JoinTiming | null = null;

export function startJoinTiming(): void {
  startedAt = performance.now();
  stages = {};
  finished = null;
}

/** The first time a stage is reached counts: a retry is part of the wait. */
export function markJoinStage(stage: JoinStage): void {
  if (startedAt === null || stages[stage] !== undefined) return;
  stages[stage] = Math.round(performance.now() - startedAt);
}

/** Ends the measure; a listener without a microphone has no microphone stages and reports them as the token. */
export function finishJoinTiming(): void {
  if (startedAt === null) return;
  markJoinStage('totalMs');
  const { totalMs = 0, connectMs = totalMs, tokenMs = connectMs } = stages;
  finished = {
    microphoneMs: stages.microphoneMs ?? tokenMs,
    tokenMs,
    connectMs,
    publishMs: stages.publishMs ?? connectMs,
    totalMs
  };
  startedAt = null;
}

/** The finished measure, once. */
export function takeJoinTiming(): JoinTiming | null {
  const timing = finished;
  finished = null;
  return timing;
}
