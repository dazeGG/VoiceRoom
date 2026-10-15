<script lang="ts">
  // A section that could not show its numbers: not signed in, not an
  // administrator, or a failed load that can be retried.
  import { resolve } from '$app/paths';
  import { Button } from '$lib/shared/ui';
  import type { LoadFailure } from './load-state';

  let { failure, onRetry }: { failure: LoadFailure; onRetry: () => void } = $props();
</script>

{#if failure.kind === 'signed_out'}
  <p class="admin-note">Войдите в аккаунт администратора: <a href={resolve('/login')}>вход</a>.</p>
{:else if failure.kind === 'forbidden'}
  <p class="admin-note">Этот раздел доступен только администратору сервиса.</p>
{:else}
  <p class="admin-error" role="alert">{failure.message}</p>
  <Button variant="outline" onclick={onRetry}>Повторить</Button>
{/if}

<style>
  .admin-note {
    color: var(--vr-text-2);
  }

  .admin-note a {
    color: var(--vr-text-2);
  }

  .admin-error {
    color: var(--vr-danger);
  }
</style>
