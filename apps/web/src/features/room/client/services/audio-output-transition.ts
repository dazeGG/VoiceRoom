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
 * Selects the saved output, or the system one when the saved output is rejected:
 * remote voices keep playing on the system device then, so staying silent would
 * only lose the interface and stream sounds. A device someone picks by hand goes
 * through transitionAudioOutput alone, so a failed pick is reported, not hidden.
 */
export async function selectOutputOrSystem(
  selectOutput: (sinkId: string) => Promise<boolean>,
  sinkId: string,
  onFallback: () => void
): Promise<boolean> {
  if (await selectOutput(sinkId)) return true;
  if (!sinkId || !(await selectOutput(''))) return false;
  onFallback();
  return true;
}
