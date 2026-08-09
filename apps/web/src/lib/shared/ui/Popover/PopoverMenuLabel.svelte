<script lang="ts">
  import type { PopoverMenuLabelProps } from './types';

  let { text }: PopoverMenuLabelProps = $props();
</script>

<!-- Presentational section heading. Grouping semantics come from the role="group"
     the caller puts around the items, so this stays out of the a11y tree. -->
<span class="popover-menu-label" aria-hidden="true">{text}</span>

<style>
  .popover-menu-label {
    display: block;
    padding: 11px 12px 6px;
    color: var(--warm-faint);
    font-family: var(--font-mono);
    font-size: 10.5px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
  }
</style>
