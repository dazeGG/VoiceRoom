<script lang="ts">
  // The mark next to a name: the service's own account (later also a
  // verified person). Nothing for everyone else.
  import { BadgeCheck } from '@lucide/svelte';
  import { badgeOf } from '$lib/shared/badges.svelte';

  let { userId, size = 15 }: { userId: string | null | undefined; size?: number } = $props();

  const badge = $derived(badgeOf(userId));
  const label = $derived(badge === 'official' ? 'Официальный аккаунт VoiceRoom' : 'Подтверждённый аккаунт');
</script>

{#if badge}
  <span class="account-badge" data-badge={badge} role="img" aria-label={label} title={label}
    ><BadgeCheck {size} strokeWidth={2.2} aria-hidden="true" /></span
  >
{/if}

<style>
  .account-badge {
    display: inline-flex;
    flex: none;
    margin-left: 4px;
    vertical-align: -0.15em;
    color: var(--vr-accent-ink);
    line-height: 0;
  }

  .account-badge :global(svg) {
    fill: var(--vr-accent);
  }
</style>
