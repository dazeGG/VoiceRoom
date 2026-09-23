export interface AudioOutputTransition {
  disconnect: () => void;
  select: () => Promise<void>;
  connect: () => void;
}

/**
 * Disconnects the audible path before selecting a sink and reconnects it only
 * after the asynchronous selection succeeds.
 */
export async function transitionAudioOutput({ disconnect, select, connect }: AudioOutputTransition): Promise<boolean> {
  disconnect();
  try {
    await select();
  } catch {
    return false;
  }
  connect();
  return true;
}

export function createAudioOutputTransitionQueue(): (transition: () => Promise<boolean>) => Promise<boolean> {
  let pending: Promise<boolean> = Promise.resolve(true);
  return (transition) => {
    pending = pending.then(transition, transition);
    return pending;
  };
}

/**
 * Initial output selection deliberately has no automatic default fallback: a
 * rejected persisted custom sink must remain silent until the user chooses a
 * different output.
 */
export function initializeAudioOutput(selectOutput: (sinkId: string) => Promise<boolean>, sinkId: string): Promise<boolean> {
  return selectOutput(sinkId);
}
