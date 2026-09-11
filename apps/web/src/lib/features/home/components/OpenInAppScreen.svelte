<script lang="ts">
  import { Button } from '$lib/shared/ui';

  let { onRetry, onContinue } = $props<{
    onRetry: () => void;
    onContinue: () => void;
  }>();
</script>

<div class="open-in-app" role="dialog" aria-modal="true" aria-labelledby="openInAppTitle">
  <div class="open-in-app-card">
    <h1 id="openInAppTitle">Открываем в приложении</h1>
    <p>
      Если Voice Room установлен, комната откроется в нём. Разрешите браузеру открыть приложение, если он спросит.
    </p>
    <div class="open-in-app-actions">
      <Button variant="primary" type="button" onclick={onRetry}>Открыть снова</Button>
      <Button variant="ghost" type="button" onclick={onContinue}>Продолжить в браузере</Button>
    </div>
  </div>
</div>

<style>
  .open-in-app {
    position: fixed;
    inset: 0;
    z-index: 60;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    background: color-mix(in srgb, var(--warm-950) 78%, transparent);
    backdrop-filter: blur(6px);
    -webkit-backdrop-filter: blur(6px);
  }

  .open-in-app-card {
    display: flex;
    flex-direction: column;
    gap: 14px;
    width: min(440px, 100%);
    padding: 26px;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: var(--radius-xl);
    background: var(--warm-800);
    box-shadow: var(--shadow);
  }

  .open-in-app-card h1 {
    margin: 0;
    color: var(--warm-ink);
    font-family: var(--font-ui);
    font-size: 20px;
    font-weight: 700;
    letter-spacing: -0.01em;
  }

  .open-in-app-card p {
    margin: 0;
    color: var(--warm-muted);
    font-size: 14px;
    line-height: 1.5;
  }

  .open-in-app-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    margin-top: 6px;
  }
</style>
