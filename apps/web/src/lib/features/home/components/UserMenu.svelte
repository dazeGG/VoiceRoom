<script lang="ts">
  import type { AuthUser } from '$lib/api/auth';

  let { user, loggingOut, onLogout } = $props<{
    user: AuthUser;
    loggingOut: boolean;
    onLogout: () => void;
  }>();

  const label = $derived(user.displayName?.trim() || user.login);
  const initials = $derived(
    label
      .split(/\s+/)
      .slice(0, 2)
      .map((part: string) => part.charAt(0))
      .join('')
      .toUpperCase() || label.charAt(0).toUpperCase()
  );
</script>

<div class="user-menu">
  <span class="user-avatar" aria-hidden="true">{initials}</span>
  <span class="user-name" title={`@${user.login}`}>{label}</span>
  <button class="user-logout" type="button" onclick={onLogout} disabled={loggingOut} aria-label="Выйти из аккаунта">
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
      <polyline points="16 17 21 12 16 7"></polyline>
      <line x1="21" y1="12" x2="9" y2="12"></line>
    </svg>
  </button>
</div>
