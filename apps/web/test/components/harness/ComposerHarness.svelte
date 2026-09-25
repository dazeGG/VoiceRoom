<script lang="ts">
  import EmojiComposer from '../../../src/lib/shared/chat/EmojiComposer.svelte';

  let { initial = '', maxlength = Number.POSITIVE_INFINITY }: { initial?: string; maxlength?: number } = $props();
  let value = $state(initial);
  let composer = $state<{ setSelection(start: number, end?: number): void; insertText(text: string): boolean } | null>(null);

  export function insert(text: string, caret?: number): boolean {
    if (caret !== undefined) composer?.setSelection(caret);
    return composer?.insertText(text) ?? false;
  }

  export function setValue(next: string): void {
    value = next;
  }
</script>

<EmojiComposer bind:this={composer} bind:value ariaLabel="Сообщение" {maxlength} />
<output data-testid="value">{value}</output>
