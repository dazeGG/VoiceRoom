<script lang="ts">
  import { contentFromLegacyText, type RoomMessageContentV1 } from '@voice-room/shared/room-message-content';

  let {
    disabled = false,
    onsubmit,
    placeholder = 'Сообщение'
  }: {
    disabled?: boolean;
    onsubmit: (value: { content: RoomMessageContentV1; text: string }) => void | Promise<void>;
    placeholder?: string;
  } = $props();

  let text = $state('');
  let submitting = $state(false);

  async function submit() {
    const content = contentFromLegacyText(text);
    if (!content || disabled || submitting) return;
    submitting = true;
    try {
      await onsubmit({ content, text });
      text = '';
    } finally {
      submitting = false;
    }
  }
</script>

<form onsubmit={(event) => { event.preventDefault(); void submit(); }}>
  <label>
    <span class="sr-only">{placeholder}</span>
    <textarea bind:value={text} {placeholder} {disabled} rows="2" onkeydown={(event) => {
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        void submit();
      }
    }}></textarea>
  </label>
  <button type="submit" disabled={disabled || submitting || !text.trim()}>Отправить</button>
</form>

<style>
  form { display: flex; gap: 8px; align-items: end; }
  label { flex: 1; }
  textarea { box-sizing: border-box; width: 100%; resize: vertical; }
  .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0, 0, 0, 0); }
</style>
