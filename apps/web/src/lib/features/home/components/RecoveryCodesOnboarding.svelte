<script lang="ts">
  import { KeyRound, MonitorSmartphone } from '@lucide/svelte';
  import { onMount } from 'svelte';
  import { RECOVERY_CODES_ONBOARDING_KEY } from '@voice-room/shared/account-security';
  import { dismissOnboarding, fetchAccountSecurity } from '$lib/api/auth';
  import { Button, Dialog } from '$lib/shared/ui';
  import { iconMd } from '$lib/shared/ui/icons';
  import { shouldOfferRecoveryCodesOnboarding } from '../model/account-security';

  let { onCreateCodes } = $props<{ onCreateCodes: () => void }>();

  let open = $state(false);

  onMount(() => {
    let cancelled = false;
    void fetchAccountSecurity()
      .then((security) => {
        if (!cancelled && shouldOfferRecoveryCodesOnboarding(security)) open = true;
      })
      .catch(() => {
        // The announcement is optional; a failed check must not get in the way.
      });
    return () => {
      cancelled = true;
    };
  });

  // Shown once per account: either answer dismisses it for good, and the
  // security settings keep offering the codes afterwards.
  function finish(createCodes: boolean): void {
    open = false;
    void dismissOnboarding(RECOVERY_CODES_ONBOARDING_KEY).catch(() => {});
    if (createCodes) onCreateCodes();
  }
</script>

<Dialog {open} title="Новое в Voice Room 2.6.0" onClose={() => finish(false)} width={460}>
  <div class="release-onboarding">
    <div class="release-onboarding-item">
      <span class="release-onboarding-icon" aria-hidden="true"><KeyRound {...iconMd} /></span>
      <div>
        <strong>Коды восстановления</strong>
        <p>Забудете пароль — войдёте по логину и одному из кодов. Создайте их сейчас: без кодов доступ к аккаунту не вернуть.</p>
      </div>
    </div>
    <div class="release-onboarding-item">
      <span class="release-onboarding-icon" aria-hidden="true"><MonitorSmartphone {...iconMd} /></span>
      <div>
        <strong>Устройства</strong>
        <p>В настройках видно, где открыт аккаунт: браузер или приложение, система, город и последний визит. Чужой сеанс можно завершить.</p>
      </div>
    </div>
  </div>
  <div class="lr-dialog-actions">
    <Button variant="ghost" type="button" onclick={() => finish(false)}>Не сейчас</Button>
    <Button variant="primary" type="button" onclick={() => finish(true)}>Создать коды</Button>
  </div>
</Dialog>

<style>
  .release-onboarding {
    display: grid;
    gap: 16px;
    margin-bottom: 6px;
  }

  .release-onboarding-item {
    display: grid;
    grid-template-columns: 36px minmax(0, 1fr);
    gap: 12px;
    align-items: start;
  }

  .release-onboarding-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    border-radius: 11px;
    background: var(--control);
    color: var(--accent);
  }

  .release-onboarding-item strong {
    color: var(--warm-ink);
    font-size: 14px;
  }

  .release-onboarding-item p {
    margin: 4px 0 0;
    color: var(--warm-muted);
    font-size: 13.5px;
    line-height: 1.45;
  }
</style>
