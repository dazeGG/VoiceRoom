<script lang="ts">
  // Edits one sent message in place: Enter saves, Escape or Отмена leaves it
  // as it was. Shared by the room and direct chats; `variant` picks the
  // surrounding chat's class names.
  import { onMount, untrack } from 'svelte';
  import type { ComposerHandle } from './composer-handle';
  import EmojiComposer from './EmojiComposer.svelte';

  let {
    text: initialText,
    variant,
    maxlength,
    onSave,
    onClose
  }: {
    text: string;
    variant: 'dm-msg' | 'chat-msg';
    maxlength: number;
    /** Rejects when the server refuses; the editor stays open to retry. */
    onSave: (text: string) => Promise<void>;
    onClose: () => void;
  } = $props();

  let editor = $state<ComposerHandle | null>(null);
  let text = $state(untrack(() => initialText));
  let saving = $state(false);

  onMount(() => {
    editor?.focus();
    editor?.setSelection(text.length);
  });

  function onKeydown(event: KeyboardEvent): void {
    if (event.isComposing) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void save();
    }
  }

  async function save(): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed || saving) return;
    saving = true;
    try {
      await onSave(trimmed);
      onClose();
    } catch {
      saving = false;
    }
  }
</script>

<div class="{variant}-edit">
  <EmojiComposer
    class="{variant}-edit-input"
    bind:this={editor}
    bind:value={text}
    {maxlength}
    ariaLabel="Текст сообщения"
    onkeydown={onKeydown}
    disabled={saving}
  />
  <div class="{variant}-edit-actions">
    <button type="button" onclick={onClose} disabled={saving}>Отмена</button>
    <button type="button" onclick={save} disabled={saving || !text.trim()}>Сохранить</button>
  </div>
</div>
