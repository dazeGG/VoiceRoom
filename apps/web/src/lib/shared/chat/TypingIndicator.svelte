<script lang="ts">
  let { label }: { label: string } = $props();
</script>

<!-- Always in the tree, so a screen reader hears the line change instead of
     meeting a live region that only appears together with its first text. -->
<p class="chat-typing" aria-live="polite">{label}</p>

<style>
  /* Sits in the top padding right above the message field, so the composer
     never jumps when someone starts or stops typing. The host sets
     --chat-typing-inset to its own side padding and is the positioned box. */
  .chat-typing {
    position: absolute;
    top: 0;
    right: var(--chat-typing-inset, 18px);
    left: var(--chat-typing-inset, 18px);
    height: 14px;
    margin: 0;
    overflow: hidden;
    color: var(--warm-muted, #8e897b);
    font-size: 11.5px;
    line-height: 14px;
    pointer-events: none;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .chat-typing:empty { visibility: hidden; }
</style>
