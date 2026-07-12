/**
 * Disconnects the audible path before selecting a sink and reconnects it only
 * after the asynchronous selection succeeds.
 *
 * @param {{ disconnect: () => void, select: () => Promise<void>, connect: () => void }} transition
 */
export async function transitionAudioOutput({ disconnect, select, connect }) {
  disconnect();
  try {
    await select();
  } catch {
    return false;
  }
  connect();
  return true;
}

export function createAudioOutputTransitionQueue() {
  let pending = Promise.resolve(true);
  return (/** @type {() => Promise<boolean>} */ transition) => {
    pending = pending.then(transition, transition);
    return pending;
  };
}
