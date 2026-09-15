<script lang="ts">
  import { Monitor, ShieldAlert, Smartphone, Smile } from '@lucide/svelte';
  import Emoji from '$lib/shared/chat/Emoji.svelte';
  import EmojiText from '$lib/shared/chat/EmojiText.svelte';
  import LinkPreviewCard from '$lib/shared/chat/LinkPreviewCard.svelte';
  import { Avatar } from '$lib/shared/ui';
  import { iconSm } from '$lib/shared/ui/icons';
  import type { WhatsNewSceneId } from '../model/whats-new';

  let { scene }: { scene: WhatsNewSceneId } = $props();

  const PICKER_EMOJI = ['😂', '🔥', '🎉', '👍', '🏕️', '🎮', '❤️', '👀'];

  // A picture drawn here rather than a file: the sample card has no stored copy.
  const bars = [14, 28, 42, 22, 36, 18, 10]
    .map((height, index) => `<rect x="${18 + index * 9}" y="${36 - height / 2}" width="5" height="${height}" rx="2.5"/>`)
    .join('');
  const THUMB_SRC = `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 72"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3f5c1f"/><stop offset="1" stop-color="#18240e"/></linearGradient></defs><rect width="96" height="72" fill="url(#g)"/><g fill="#d4f53c">${bars}</g></svg>`
  )}`;

  const SAMPLE_PREVIEW = {
    url: 'https://habr.com/',
    siteName: 'Хабр',
    title: 'Как устроены голосовые чаты изнутри',
    description: 'Разбираем, как собеседники слышат друг друга без задержек: WebRTC, SFU и немного магии.',
    // The size is real; the key is never fetched, imageSrc draws the picture.
    image: { key: 'whats-new-sample', width: 96, height: 72 }
  };
</script>

<!-- Made of the real chat pieces, so the picture follows the app's look. It is
     only an illustration: nothing inside can be focused or clicked. -->
<div class="scene" inert aria-hidden="true">
  {#if scene === 'emoji'}
    <div class="scene-message">
      <Avatar name="Аня" colorKey="orchid" size={32} />
      <div>
        <span class="scene-author">Аня</span>
        <span class="scene-text"><EmojiText text="едем в субботу? 🏕️🔥" /></span>
        <span class="scene-reactions">
          <span class="scene-reaction scene-reaction--mine"><Emoji emoji="🎉" size={15} /> 3</span>
          <span class="scene-reaction"><Emoji emoji="👍" size={15} /> 1</span>
        </span>
      </div>
    </div>
    <div class="scene-composer">
      <span>Написать сообщение…</span>
      <span class="scene-smile"><Smile {...iconSm} /></span>
      <span class="scene-picker">
        {#each PICKER_EMOJI as emoji, index (emoji)}
          <span class="scene-picker-cell" class:scene-picker-cell--hover={index === 4}><Emoji {emoji} size={20} /></span>
        {/each}
      </span>
    </div>
  {:else if scene === 'links'}
    <div class="scene-message">
      <Avatar name="Боря" colorKey="blurple" size={32} />
      <div class="scene-message-body">
        <span class="scene-author">Боря</span>
        <span class="scene-text"><EmojiText text="смотри, что нашёл 👀" /></span>
        <LinkPreviewCard preview={SAMPLE_PREVIEW} imageSrc={THUMB_SRC} />
      </div>
    </div>
  {:else if scene === 'security'}
    <div class="scene-devices">
      <div class="scene-device">
        <span class="scene-device-icon"><Monitor {...iconSm} /></span>
        <span class="scene-device-text"><strong>Chrome · Windows</strong><small>Москва · этот сеанс</small></span>
        <span class="scene-device-now">Сейчас</span>
      </div>
      <div class="scene-device">
        <span class="scene-device-icon"><Smartphone {...iconSm} /></span>
        <span class="scene-device-text"><strong>Safari · iOS</strong><small>Казань · вчера</small></span>
        <span class="scene-device-end">Завершить</span>
      </div>
    </div>
    <div class="scene-alert">
      <span class="scene-alert-icon"><ShieldAlert {...iconSm} /></span>
      <span class="scene-device-text"><strong>Новый вход</strong><small>Firefox · Linux, Самара</small></span>
      <span class="scene-alert-actions">
        <span class="scene-chip">Это я</span>
        <span class="scene-chip scene-chip--danger">Не я</span>
      </span>
    </div>
  {/if}
</div>

<style>
  .scene {
    display: grid;
    align-content: center;
    gap: 14px;
    height: 208px;
    padding: 18px;
    overflow: hidden;
    border-radius: var(--radius-lg);
    background:
      radial-gradient(120% 90% at 90% 0%, color-mix(in oklch, var(--accent), transparent 84%), transparent 62%),
      var(--panel);
    color: var(--warm-ink);
    font-size: 13px;
    line-height: 1.4;
    user-select: none;
  }

  .scene-message {
    display: grid;
    grid-template-columns: 32px minmax(0, 1fr);
    gap: 10px;
    align-items: start;
  }

  .scene-message-body {
    min-width: 0;
  }

  .scene-author {
    display: block;
    font-weight: 700;
  }

  .scene-text {
    display: block;
    color: var(--warm-ink-dim);
  }

  .scene-reactions {
    display: flex;
    gap: 6px;
    margin-top: 6px;
  }

  .scene-reaction {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 8px;
    border-radius: var(--radius-pill);
    background: var(--control);
    font-size: 12px;
  }

  .scene-reaction--mine {
    background: color-mix(in oklch, var(--accent), transparent 86%);
    box-shadow: inset 0 0 0 1px color-mix(in oklch, var(--accent), transparent 40%);
  }

  .scene-composer {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 38px;
    padding: 0 6px 0 12px;
    border-radius: 10px;
    background: var(--control);
    color: var(--warm-faint);
  }

  .scene-smile {
    display: inline-flex;
    padding: 6px;
    border-radius: 8px;
    background: color-mix(in oklch, var(--accent), transparent 86%);
    color: var(--accent);
  }

  .scene-picker {
    position: absolute;
    right: 0;
    bottom: calc(100% + 6px);
    display: grid;
    grid-template-columns: repeat(4, 28px);
    gap: 2px;
    padding: 5px;
    border-radius: 10px;
    background: var(--warm-800);
    box-shadow: var(--shadow);
  }

  .scene-picker-cell {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    height: 28px;
    border-radius: 6px;
  }

  .scene-picker-cell--hover {
    background: var(--control-hover);
  }

  .scene-devices {
    display: grid;
    overflow: hidden;
    border-radius: 12px;
    background: var(--control);
  }

  .scene-device,
  .scene-alert {
    display: grid;
    grid-template-columns: 30px minmax(0, 1fr) auto;
    gap: 10px;
    align-items: center;
    padding: 8px 12px;
  }

  .scene-device + .scene-device {
    border-top: 1px solid color-mix(in oklch, var(--warm-ink), transparent 92%);
  }

  .scene-device-icon,
  .scene-alert-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 30px;
    border-radius: 8px;
    background: var(--panel);
    color: var(--warm-muted);
  }

  .scene-device-text {
    min-width: 0;
  }

  .scene-device-text strong,
  .scene-device-text small {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .scene-device-text small {
    color: var(--warm-muted);
    font-size: 12px;
  }

  .scene-device-now {
    color: var(--green);
    font-size: 12px;
  }

  .scene-device-end {
    color: var(--warm-muted);
    font-size: 12px;
  }

  .scene-alert {
    border-radius: 12px;
    background: var(--warm-800);
    box-shadow: inset 0 0 0 1px color-mix(in oklch, var(--accent), transparent 55%);
  }

  .scene-alert-icon {
    color: var(--accent);
  }

  .scene-alert-actions {
    display: flex;
    gap: 6px;
  }

  .scene-chip {
    padding: 3px 9px;
    border-radius: var(--radius-pill);
    background: var(--control);
    font-size: 12px;
  }

  .scene-chip--danger {
    background: color-mix(in oklch, var(--danger), transparent 80%);
    color: var(--warm-ink);
  }
</style>
