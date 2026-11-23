import { createPinia, getActivePinia, setActivePinia } from 'pinia';
import { onTestFinished } from 'vitest';

/** Install against this fixture's Pinia and this module graph after resetModules. */
export async function installWebCallPortsForTest(): Promise<void> {
  const pinia = getActivePinia() ?? setActivePinia(createPinia());
  const { installCallPorts } = await import('@voiceroom/call/engine/ports');
  const { createWebCallPorts } = await import('@/features/room/adapters/web-call-ports');
  onTestFinished(installCallPorts(createWebCallPorts(pinia)));
}
