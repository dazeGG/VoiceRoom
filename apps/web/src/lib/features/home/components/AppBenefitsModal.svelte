<script lang="ts">
  import { onMount } from 'svelte';
  import { Button, Dialog } from '$lib/shared/ui';
  import { createDesktopDownload } from '../services/desktop-download';

  let { open, onClose } = $props<{
    open: boolean;
    /** Called on close and after the download starts. */
    onClose: () => void;
  }>();

  const BENEFITS = [
    { title: 'Оверлей поверх игр', text: 'Видно, кто говорит, не сворачивая игру.' },
    { title: 'Горячие клавиши и Push-to-talk', text: 'Микрофон и звук с клавиатуры, даже когда окно не в фокусе.' },
    { title: 'Запуск вместе с системой', text: 'Приложение уже открыто, когда друзья зовут в комнату.' },
    { title: 'Уведомления на рабочем столе', text: 'Сообщения и звонки не теряются во вкладках браузера.' }
  ];

  let startDownload: (() => Promise<void>) | null = null;
  let downloading = $state(false);

  onMount(() => {
    startDownload = createDesktopDownload();
  });

  async function download(): Promise<void> {
    if (downloading || !startDownload) return;
    downloading = true;
    try {
      await startDownload();
      onClose();
    } finally {
      downloading = false;
    }
  }
</script>

<Dialog {open} title="Voice Room на компьютере" {onClose} width={460}>
  <ul class="app-benefits">
    {#each BENEFITS as benefit (benefit.title)}
      <li>
        <strong>{benefit.title}</strong>
        <span>{benefit.text}</span>
      </li>
    {/each}
  </ul>
  <div class="app-benefits-actions">
    <Button variant="primary" type="button" disabled={downloading} onclick={download}>Скачать приложение</Button>
    <Button variant="ghost" type="button" onclick={onClose}>Не сейчас</Button>
  </div>
</Dialog>

<style>
  .app-benefits {
    display: grid;
    gap: 12px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .app-benefits li {
    display: grid;
    gap: 2px;
  }

  .app-benefits strong {
    color: var(--warm-ink);
    font-size: 14px;
    font-weight: 700;
  }

  .app-benefits span {
    color: var(--warm-muted);
    font-size: 13px;
    line-height: 1.45;
  }

  .app-benefits-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    margin-top: 18px;
  }
</style>
