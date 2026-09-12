<script lang="ts">
  import { KeyRound, LockKeyhole, MonitorSmartphone } from '@lucide/svelte';
  import { onMount } from 'svelte';
  import { fetchWhatsNew, markWhatsNewSeen } from '$lib/api/auth';
  import { Button, Dialog } from '$lib/shared/ui';
  import { iconMd } from '$lib/shared/ui/icons';
  import { WHATS_NEW_ITEMS, shouldShowWhatsNew, type WhatsNewIcon } from '../model/whats-new';

  let { onOpenSecurity } = $props<{ onOpenSecurity: () => void }>();

  const ICONS: Record<WhatsNewIcon, typeof KeyRound> = {
    devices: MonitorSmartphone,
    key: KeyRound,
    password: LockKeyhole
  };

  let open = $state(false);

  onMount(() => {
    let cancelled = false;
    void fetchWhatsNew()
      .then((state) => {
        if (!cancelled && shouldShowWhatsNew(state)) open = true;
      })
      .catch(() => {
        // The announcement is optional; a failed check must not get in the way.
      });
    return () => {
      cancelled = true;
    };
  });

  // Recorded as seen however the dialog is closed, so each release is shown once.
  function finish(openSecurity: boolean): void {
    open = false;
    void markWhatsNewSeen().catch(() => {});
    if (openSecurity) onOpenSecurity();
  }
</script>

<Dialog {open} title="Что нового в Voice Room" onClose={() => finish(false)} width={480}>
  <ul class="whats-new">
    {#each WHATS_NEW_ITEMS as item (item.title)}
      {@const Icon = ICONS[item.icon]}
      <li class="whats-new-item">
        <span class="whats-new-icon" aria-hidden="true"><Icon {...iconMd} /></span>
        <div>
          <strong>{item.title}</strong>
          <p>{item.text}</p>
        </div>
      </li>
    {/each}
  </ul>
  <div class="lr-dialog-actions">
    <Button variant="ghost" type="button" onclick={() => finish(true)}>Открыть «Безопасность»</Button>
    <Button variant="primary" type="button" onclick={() => finish(false)}>Понятно</Button>
  </div>
</Dialog>

<style>
  .whats-new {
    display: grid;
    gap: 16px;
    margin: 0 0 6px;
    padding: 0;
    list-style: none;
  }

  .whats-new-item {
    display: grid;
    grid-template-columns: 36px minmax(0, 1fr);
    gap: 12px;
    align-items: start;
  }

  .whats-new-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    border-radius: 11px;
    background: var(--control);
    color: var(--accent);
  }

  .whats-new-item strong {
    color: var(--warm-ink);
    font-size: 14px;
  }

  .whats-new-item p {
    margin: 4px 0 0;
    color: var(--warm-muted);
    font-size: 13.5px;
    line-height: 1.45;
  }
</style>
