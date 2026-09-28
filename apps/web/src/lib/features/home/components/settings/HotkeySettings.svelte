<script lang="ts">
  import type { ToastOptions } from '../../model/toasts.svelte';
  import HotkeyRow from './HotkeyRow.svelte';

  let {
    globalHotkeys,
    onToast
  }: {
    /** This desktop build can register shortcuts outside its own window. */
    globalHotkeys: boolean;
    onToast: (message: string, options?: ToastOptions) => void;
  } = $props();

  function onPushToTalkOff(): void {
    onToast('Push-to-talk выключен: клавиша не назначена');
  }
</script>

<div class="settings-hotkeys">
  <div>
    <span class="settings-section-title">Горячие клавиши</span>
    <div class="settings-gate-hint">
      Назначенные сочетания работают глобально в desktop-приложении, пока вы подключены к голосу.
    </div>
  </div>

  <div class="settings-hotkey-list">
    <HotkeyRow
      action="mic-mute"
      label="Мьют микрофона"
      description="Включить или выключить микрофон"
      ariaLabel="Хоткей мьюта микрофона"
      {onPushToTalkOff}
    />
    <HotkeyRow
      action="output-mute"
      label="Мьют звука"
      description="Заглушить весь вывод и микрофон"
      ariaLabel="Хоткей мьюта звука"
      {onPushToTalkOff}
    />
    <HotkeyRow
      action="push-to-talk"
      label="Push-to-talk"
      description="Удерживайте, чтобы открыть микрофон"
      ariaLabel="Клавиша Push-to-talk"
      {onPushToTalkOff}
    />
  </div>
  <div class="settings-hotkey-window-note">
    {#if globalHotkeys}
      В приложении VoiceRoom успешно зарегистрированные сочетания работают поверх других окон, пока вы подключены к
      голосу. На macOS может потребоваться разрешение «Мониторинг ввода».
    {:else}
      Системные сочетания недоступны в этой сборке приложения.
    {/if}
  </div>
</div>

<style>
  :global(.settings-hotkey-list) {
    display: grid;
    gap: 14px;
  }
</style>
