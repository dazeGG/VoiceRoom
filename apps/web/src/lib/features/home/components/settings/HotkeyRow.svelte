<script lang="ts">
  import { untrack } from 'svelte';
  import { HotkeyRecorder } from '$lib/shared/ui';
  import {
    getDefaultHotkeyBinding,
    readHotkeyBinding,
    type HotkeyAction
  } from '$lib/features/room/client/core/hotkeys';
  import { setDesktopGlobalHotkeysSuspended } from '$lib/features/room/client/services/desktop-hotkey-service';
  import { saveHotkey } from '../../model/hotkey-settings';

  let {
    action,
    label,
    description,
    ariaLabel,
    disabled = false,
    onPushToTalkOff
  }: {
    action: HotkeyAction;
    label: string;
    description: string;
    ariaLabel: string;
    disabled?: boolean;
    /** Clearing the push-to-talk key switched the microphone back to open. */
    onPushToTalkOff: () => void;
  } = $props();

  let value = $state(untrack(() => readHotkeyBinding(action)));

  function change(binding: typeof value): void {
    if (saveHotkey(action, binding)) onPushToTalkOff();
  }
</script>

<div class="settings-hotkey-row" data-disabled={disabled ? 'true' : undefined}>
  <div>
    <span class="settings-hotkey-label">{label}</span>
    <span class="settings-hotkey-description">{description}</span>
  </div>
  <HotkeyRecorder
    bind:value
    defaultValue={getDefaultHotkeyBinding(action)}
    {disabled}
    {ariaLabel}
    onRecordingChange={(recording: boolean) => void setDesktopGlobalHotkeysSuspended(recording)}
    onValueChange={change}
  />
</div>
