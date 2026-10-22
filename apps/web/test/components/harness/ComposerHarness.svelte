<script lang="ts">
  import EmojiComposer from '../../../src/lib/shared/chat/EmojiComposer.svelte';
  import type { ComposerApi } from './composer-api';

  let {
    initial = '',
    maxlength = Number.POSITIVE_INFINITY,
    onApi
  }: { initial?: string; maxlength?: number; onApi?: (api: ComposerApi) => void } = $props();
  let value = $state(initial);
  let composer = $state<{ setSelection(start: number, end?: number): void; insertText(text: string): boolean } | null>(
    null
  );

  function insert(text: string, caret?: number): boolean {
    if (caret !== undefined) composer?.setSelection(caret);
    return composer?.insertText(text) ?? false;
  }

  function setValue(next: string): void {
    value = next;
  }

  onApi?.({ insert, setValue });
</script>

<EmojiComposer bind:this={composer} bind:value ariaLabel="Сообщение" {maxlength} />
<output data-testid="value">{value}</output>
