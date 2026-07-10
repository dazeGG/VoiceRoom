<script lang="ts">
  import { Eye, EyeOff } from '@lucide/svelte';
  import { iconMd } from '$lib/shared/ui/icons';
  import type { HTMLInputAttributes } from 'svelte/elements';

  let {
    value = $bindable(),
    placeholder = '',
    autocomplete = 'current-password',
    id
  }: {
    value: string;
    placeholder?: string;
    autocomplete?: HTMLInputAttributes['autocomplete'];
    id?: string;
  } = $props();

  let revealed = $state(false);
</script>

<div class="auth-password">
  <input
    class="auth-input"
    {id}
    type={revealed ? 'text' : 'password'}
    {placeholder}
    {autocomplete}
    bind:value
  />
  <button
    type="button"
    class="auth-eye"
    aria-label={revealed ? 'Скрыть пароль' : 'Показать пароль'}
    aria-pressed={revealed}
    onclick={() => (revealed = !revealed)}
  >
    {#if revealed}
      <EyeOff {...iconMd} aria-hidden="true" />
    {:else}
      <Eye {...iconMd} aria-hidden="true" />
    {/if}
  </button>
</div>
