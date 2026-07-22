<script lang="ts">
  import { Send, X } from '@lucide/svelte';
  import { tick } from 'svelte';
  import ReplyPreview from './ReplyPreview.svelte';
  import type { ReplySendInput, ReplyStore } from './reply-store.svelte';

  let {
    store,
    onsend,
    onjump,
    placeholder = 'Написать ответ',
    disabled = false,
    ariaLabel = 'Ответ на сообщение'
  }: {
    store: ReplyStore;
    onsend: (input: ReplySendInput) => Promise<unknown>;
    onjump?: (messageId: string) => void | Promise<void>;
    placeholder?: string;
    disabled?: boolean;
    ariaLabel?: string;
  } = $props();

  let input: HTMLTextAreaElement | null = $state(null);
  let observedFocusRequest = 0;
  const target = $derived(store.target);

  $effect(() => {
    const request = store.focusRequest;
    if (request === observedFocusRequest) return;
    observedFocusRequest = request;
    void tick().then(() => input?.focus());
  });

  function resize(): void {
    if (!input) return;
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 140)}px`;
  }

  function updateDraft(event: Event): void {
    store.setDraft((event.currentTarget as HTMLTextAreaElement).value);
    resize();
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.isComposing) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      store.cancel();
      return;
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void submit();
    }
  }

  async function submit(): Promise<void> {
    const sent = await store.submit(onsend);
    if (!sent) return;
    await tick();
    if (input) input.style.height = '';
  }

  async function jump(messageId: string): Promise<void> {
    store.requestJump(messageId);
    await onjump?.(messageId);
  }
</script>

<div class="reply-composer" aria-label={ariaLabel}>
  {#if target}
    <div class="reply-composer-target">
      <ReplyPreview preview={target} interactive={!target.deleted} onjump={jump} />
      <button class="reply-composer-cancel" type="button" aria-label="Отменить ответ" onclick={() => store.cancel()}>
        <X size={18} aria-hidden="true" />
      </button>
    </div>
  {/if}

  <div class="reply-composer-input">
    <textarea
      bind:this={input}
      value={store.draft}
      {placeholder}
      aria-label={placeholder}
      aria-describedby={store.error ? 'reply-composer-error' : undefined}
      disabled={disabled || store.sending || !target || target.deleted}
      rows="1"
      oninput={updateDraft}
      onkeydown={onKeydown}
    ></textarea>
    <button
      type="button"
      aria-label="Отправить ответ"
      disabled={disabled || store.sending || !target || target.deleted || !store.draft.trim()}
      onclick={() => void submit()}
    >
      <Send size={19} aria-hidden="true" />
    </button>
  </div>

  {#if store.error}
    <p id="reply-composer-error" role="alert" aria-live="polite">{store.error}</p>
  {/if}
</div>

<style>
  .reply-composer {
    display: grid;
    gap: 6px;
    min-width: 0;
  }

  .reply-composer-target,
  .reply-composer-input {
    display: flex;
    align-items: center;
    min-width: 0;
  }

  .reply-composer-target {
    position: relative;
    padding-inline-end: 42px;
  }

  .reply-composer-cancel {
    position: absolute;
    inset-inline-end: 5px;
  }

  .reply-composer-input {
    gap: 6px;
  }

  textarea {
    flex: 1;
    min-height: 44px;
    max-height: 140px;
    resize: none;
  }

  button {
    display: inline-grid;
    place-items: center;
    min-width: 44px;
    min-height: 44px;
    border: 0;
    border-radius: 10px;
    cursor: pointer;
  }

  button:disabled {
    cursor: default;
    opacity: 0.5;
  }

  p {
    margin: 0;
    color: var(--coral);
    font-size: 0.8rem;
  }
</style>
