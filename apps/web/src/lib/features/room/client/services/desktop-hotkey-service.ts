import type { HotkeyBinding } from '$lib/shared/ui/HotkeyRecorder/types';
import {
  HOTKEY_BINDINGS_CHANGED_EVENT,
  readHotkeyBinding,
  type HotkeyAction
} from '../core/hotkeys';

export type DesktopGlobalHotkeyAction = HotkeyAction;
export type DesktopGlobalHotkeyPhase = 'pressed' | 'released';

export interface DesktopHotkeyFailure {
  action: DesktopGlobalHotkeyAction;
  reason: string;
}

export interface DesktopHotkeyRegistrationResult {
  active: boolean;
  backend: 'native' | 'electron-fallback' | 'none';
  configurationId?: number;
  failed: DesktopHotkeyFailure[];
  registered: DesktopGlobalHotkeyAction[];
  unsupported: HotkeyAction[];
}

type RegistrationStatusHandler = (result: DesktopHotkeyRegistrationResult) => void;
type DesktopActionHandler = (
  action: DesktopGlobalHotkeyAction,
  phase: DesktopGlobalHotkeyPhase,
  options?: { immediate?: boolean }
) => void;

const GLOBAL_ACTIONS: readonly DesktopGlobalHotkeyAction[] = [
  'mic-mute',
  'output-mute',
  'push-to-talk'
];

let voiceActive = false;
let syncGeneration = 0;
let activeConfigurationId = 0;
let registeredActions = new Set<DesktopGlobalHotkeyAction>();
let pendingSyncGeneration = 0;
let pendingRegistrationActions = new Set<DesktopGlobalHotkeyAction>();
let pendingActionEvents: Array<{
  action: DesktopGlobalHotkeyAction;
  phase: DesktopGlobalHotkeyPhase;
}> = [];
let pendingRegistrationStatus: DesktopHotkeyRegistrationResult | null = null;
let desktopActionHandler: DesktopActionHandler | null = null;
let registrationStatusHandler: RegistrationStatusHandler | null = null;
let desktopPushToTalkPressed = false;

function getBridge(): Window['voiceRoomDesktopHotkeys'] | undefined {
  if (typeof window === 'undefined') return undefined;
  return window.voiceRoomDesktopHotkeys;
}

function isGlobalAction(value: unknown): value is DesktopGlobalHotkeyAction {
  return typeof value === 'string' && GLOBAL_ACTIONS.includes(value as DesktopGlobalHotkeyAction);
}

function getBindings(): Partial<Record<DesktopGlobalHotkeyAction, HotkeyBinding | null>> {
  return {
    'mic-mute': readHotkeyBinding('mic-mute'),
    'output-mute': readHotkeyBinding('output-mute'),
    'push-to-talk': readHotkeyBinding('push-to-talk')
  };
}

function applyRegistrationResult(result: DesktopHotkeyRegistrationResult): void {
  registeredActions = new Set(
    Array.isArray(result.registered) ? result.registered.filter(isGlobalAction) : []
  );
  registrationStatusHandler?.(result);
}

function deliverDesktopAction(
  action: DesktopGlobalHotkeyAction,
  phase: DesktopGlobalHotkeyPhase,
  options?: { immediate?: boolean }
): void {
  if (action === 'push-to-talk') desktopPushToTalkPressed = phase === 'pressed';
  desktopActionHandler?.(action, phase, options);
}

function configurationMatches(configurationId: number | undefined): boolean {
  // Older desktop shells do not include an id. Keep them functional while new
  // shells get strict stale-event isolation.
  return configurationId === undefined || configurationId === activeConfigurationId;
}

function finishPendingSync(
  generation: number,
  effectiveResult: DesktopHotkeyRegistrationResult | null
): void {
  if (pendingSyncGeneration !== generation) return;

  pendingSyncGeneration = 0;
  pendingRegistrationActions.clear();

  pendingRegistrationStatus = null;

  const actions = pendingActionEvents;
  pendingActionEvents = [];
  if (!voiceActive || effectiveResult?.active !== true) return;
  const finalRegistrations = new Set(effectiveResult.registered.filter(isGlobalAction));
  for (const payload of actions) {
    if (payload.action === 'push-to-talk' || !finalRegistrations.has(payload.action)) continue;
    deliverDesktopAction(payload.action, payload.phase);
  }

  let finalPushToTalk: (typeof actions)[number] | undefined;
  for (const payload of actions) {
    if (payload.action === 'push-to-talk') finalPushToTalk = payload;
  }
  if (
    finalPushToTalk?.phase === 'pressed'
    && finalRegistrations.has('push-to-talk')
  ) deliverDesktopAction('push-to-talk', 'pressed');
}

export function desktopGlobalHotkeysAvailable(): boolean {
  const bridge = getBridge();
  return Boolean(bridge?.configure && bridge?.onAction);
}

export function isDesktopGlobalHotkeyRegistered(action: DesktopGlobalHotkeyAction): boolean {
  return registeredActions.has(action) || pendingRegistrationActions.has(action);
}

export async function syncDesktopGlobalHotkeys(active = voiceActive): Promise<DesktopHotkeyRegistrationResult | null> {
  if (desktopPushToTalkPressed) {
    deliverDesktopAction('push-to-talk', 'released', { immediate: true });
  }
  voiceActive = Boolean(active);
  const bridge = getBridge();
  const generation = ++syncGeneration;
  activeConfigurationId = generation;
  const bindings = voiceActive ? getBindings() : {};

  registeredActions.clear();
  pendingSyncGeneration = generation;
  pendingRegistrationActions = new Set(
    GLOBAL_ACTIONS.filter((action) => Boolean(bindings[action]))
  );
  pendingActionEvents = [];
  pendingRegistrationStatus = null;

  if (!bridge?.configure) {
    finishPendingSync(generation, null);
    return null;
  }

  try {
    const result = await bridge.configure({
      active: voiceActive,
      configurationId: activeConfigurationId,
      bindings
    });
    if (generation !== syncGeneration) return result;

    const effectiveResult = pendingRegistrationStatus ?? result;
    applyRegistrationResult(effectiveResult);
    finishPendingSync(generation, effectiveResult);
    return effectiveResult;
  } catch (error) {
    if (generation === syncGeneration) {
      registeredActions.clear();
      pendingActionEvents = [];
      pendingRegistrationStatus = null;
      finishPendingSync(generation, null);
    }
    console.warn('Desktop hotkey sync failed', error);
    return null;
  }
}

export async function setDesktopGlobalHotkeysSuspended(suspended: boolean): Promise<void> {
  const bridge = getBridge();
  if (!bridge?.setSuspended) return;
  try {
    await bridge.setSuspended(Boolean(suspended));
  } catch (error) {
    console.warn('Desktop hotkey suspension failed', error);
  }
}

export function bindDesktopGlobalHotkeys(
  onAction: DesktopActionHandler,
  onRegistrationStatus?: RegistrationStatusHandler
): () => void {
  const bridge = getBridge();
  desktopActionHandler = onAction;
  registrationStatusHandler = onRegistrationStatus ?? null;

  const removeActionListener = bridge?.onAction?.((payload) => {
    if (
      !voiceActive
      || !isGlobalAction(payload?.action)
      || !configurationMatches(payload.configurationId)
    ) return;
    const phase = payload?.phase === 'released' ? 'released' : 'pressed';
    if (pendingSyncGeneration !== 0) {
      pendingActionEvents.push({ action: payload.action, phase });
      return;
    }
    if (registeredActions.has(payload.action)) deliverDesktopAction(payload.action, phase);
  }) ?? (() => {});
  const removeStatusListener = bridge?.onStatus?.((result) => {
    if (
      !voiceActive
      || !result
      || result.active !== true
      || !configurationMatches(result.configurationId)
    ) return;
    if (pendingSyncGeneration !== 0) {
      pendingRegistrationStatus = result;
      return;
    }
    applyRegistrationResult(result);
  }) ?? (() => {});

  const onBindingsChanged = (): void => {
    if (voiceActive) void syncDesktopGlobalHotkeys(true);
  };
  window.addEventListener(HOTKEY_BINDINGS_CHANGED_EVENT, onBindingsChanged);

  return () => {
    window.removeEventListener(HOTKEY_BINDINGS_CHANGED_EVENT, onBindingsChanged);
    removeActionListener();
    removeStatusListener();
    if (desktopActionHandler === onAction) desktopActionHandler = null;
    if (registrationStatusHandler === onRegistrationStatus) registrationStatusHandler = null;
  };
}
