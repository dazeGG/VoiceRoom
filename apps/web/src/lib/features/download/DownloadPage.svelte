<script lang="ts">
  import { onMount } from 'svelte';
  import '$lib/components/topbar.css';
  import './download.css';

  type Platform = 'mac' | 'win';

  interface Build {
    id: string;
    action: string;
    meta: string;
    primary: boolean;
  }

  const QUARANTINE_CMD = 'sudo xattr -rd com.apple.quarantine /Applications/Voice\\ Room.app';

  const PLATFORM_LABEL: Record<Platform, string> = {
    mac: 'macOS',
    win: 'Windows'
  };

  const BUILDS: Record<Platform, Build[]> = {
    mac: [
      { id: 'mac-arm64', action: 'Скачать · Apple Silicon', meta: '.dmg · ~100 МБ · arm64', primary: true },
      { id: 'mac-x64', action: 'Скачать · Intel', meta: '.dmg · ~100 МБ · x64', primary: false }
    ],
    win: [
      { id: 'win-x64', action: 'Скачать для Windows', meta: '.exe · ~100 МБ · 64-bit', primary: true }
    ]
  };

  const PLATFORMS: Platform[] = ['mac', 'win'];

  let selected = $state<Platform>('mac');
  let loadingBuildId = $state('');
  let completedBuildId = $state('');
  let copied = $state(false);
  let copyResetTimer = 0;
  let downloadResetTimer = 0;

  onMount(() => {
    selected = detectPlatform();
    return () => {
      window.clearTimeout(copyResetTimer);
      window.clearTimeout(downloadResetTimer);
    };
  });

  function detectPlatform(): Platform {
    try {
      const ua = `${navigator.userAgent || ''} ${navigator.platform || ''}`;
      if (/Win/i.test(ua)) return 'win';
    } catch {
      // Default to mac below.
    }
    return 'mac';
  }

  function handleDownload(build: Build): void {
    if (loadingBuildId) return;

    loadingBuildId = build.id;
    completedBuildId = '';

    window.setTimeout(() => {
      loadingBuildId = '';
      completedBuildId = build.id;
      // TODO: replace with the real build URL for `build.id` once artifacts are published.
    }, 1500);

    window.clearTimeout(downloadResetTimer);
    downloadResetTimer = window.setTimeout(() => {
      completedBuildId = '';
    }, 4800);
  }

  async function copyQuarantineCommand(): Promise<void> {
    try {
      await navigator.clipboard?.writeText(QUARANTINE_CMD);
    } catch {
      // Clipboard may be unavailable; still show feedback.
    }

    copied = true;
    window.clearTimeout(copyResetTimer);
    copyResetTimer = window.setTimeout(() => {
      copied = false;
    }, 2000);
  }

  function downloadLabel(build: Build): string {
    if (loadingBuildId === build.id) return 'Загрузка…';
    if (completedBuildId === build.id) return 'Загрузка началась';
    return build.action;
  }
</script>

<div class="dl-page">
  <header class="topbar">
    <a class="brand" href="/" aria-label="На главную Voice Room">
      <img class="brand-mark" src="/icon.svg" width="32" height="32" alt="" aria-hidden="true">
      <span>Voice Room</span>
    </a>
  </header>

  <main class="dl-main">
    <div class="dl-grid">
      <section class="dl-intro" aria-labelledby="dlTitle">
        <p class="dl-eyebrow">Скачать приложение</p>
        <h1 class="dl-title" id="dlTitle">Voice Room на вашем компьютере</h1>
        <p class="dl-lead">Десктопное приложение для голосовых комнат. Поставьте один раз — заходите по коду в один клик, без браузера и лишних вкладок.</p>

        <ul class="dl-features">
          <li class="dl-feature">
            <span class="dl-feature-num">01</span>
            <div class="dl-feature-body">
              <p class="dl-feature-title">Заходите по коду</p>
              <p class="dl-feature-desc">Без приглашений и ссылок: создайте комнату и поделитесь кодом. Она живёт, пока в ней есть люди.</p>
            </div>
          </li>
          <li class="dl-feature">
            <span class="dl-feature-num">02</span>
            <div class="dl-feature-body">
              <p class="dl-feature-title">Никаких аккаунтов</p>
              <p class="dl-feature-desc">Регистрации нет. Всё, что мы знаем о вас — имя, которое вы задали сами, оно хранится прямо на вашем устройстве.</p>
            </div>
          </li>
          <li class="dl-feature">
            <span class="dl-feature-num">03</span>
            <div class="dl-feature-body">
              <p class="dl-feature-title">Демонстрация экрана</p>
              <p class="dl-feature-desc">Когда нужно — выберите окно или весь экран и подтвердите доступ, показ начнётся сразу после этого.</p>
            </div>
          </li>
          <li class="dl-feature">
            <span class="dl-feature-num">04</span>
            <div class="dl-feature-body">
              <p class="dl-feature-title">Отдельное приложение</p>
              <p class="dl-feature-desc">Своё окно и горячие клавиши — Voice Room не теряется среди вкладок браузера.</p>
            </div>
          </li>
        </ul>
      </section>

      <aside class="dl-card" aria-label="Загрузка">
        <div class="dl-card-head">
          <p class="dl-card-eyebrow">Загрузка</p>
          <p class="dl-card-sub">Рекомендуем версию для вашей системы.</p>
        </div>

        <div class="dl-platform-switch" id="dlPlatformSwitch" role="tablist" aria-label="Платформа">
          {#each PLATFORMS as platform}
            <button
              type="button"
              class={`dl-platform-tab${selected === platform ? ' is-active' : ''}`}
              role="tab"
              aria-selected={selected === platform}
              data-platform={platform}
              onclick={() => selected = platform}
            >
              <span aria-hidden="true">
                {#if platform === 'mac'}
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="13" rx="2"></rect><line x1="9" y1="20" x2="15" y2="20"></line><line x1="12" y1="17" x2="12" y2="20"></line></svg>
                {:else}
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"></rect><line x1="3" y1="9" x2="21" y2="9"></line><circle cx="6.5" cy="6.5" r="0.6" fill="currentColor" stroke="none"></circle><circle cx="9" cy="6.5" r="0.6" fill="currentColor" stroke="none"></circle></svg>
                {/if}
              </span>
              <span>{PLATFORM_LABEL[platform]}</span>
            </button>
          {/each}
        </div>

        <div class="dl-buttons" id="dlButtons">
          {#each BUILDS[selected] as build}
            <button
              class={`dl-btn${build.primary ? ' dl-btn--primary' : ''}${loadingBuildId === build.id ? ' is-loading' : ''}`}
              type="button"
              onclick={() => handleDownload(build)}
            >
              <span class="dl-btn-icon" aria-hidden="true">
                {#if selected === 'mac'}
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="13" rx="2"></rect><line x1="9" y1="20" x2="15" y2="20"></line><line x1="12" y1="17" x2="12" y2="20"></line></svg>
                {:else}
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"></rect><line x1="3" y1="9" x2="21" y2="9"></line><circle cx="6.5" cy="6.5" r="0.6" fill="currentColor" stroke="none"></circle><circle cx="9" cy="6.5" r="0.6" fill="currentColor" stroke="none"></circle></svg>
                {/if}
              </span>
              <span class="dl-btn-copy">
                <span class="dl-btn-action" data-action>{downloadLabel(build)}</span>
                <span class="dl-btn-meta">{build.meta}</span>
              </span>
              <span class="dl-btn-trail" aria-hidden="true">
                <span class="dl-btn-arrow">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="4" x2="12" y2="15"></line><polyline points="7 11 12 16 17 11"></polyline><line x1="5" y1="20" x2="19" y2="20"></line></svg>
                </span>
                <span class="dl-btn-spinner"></span>
              </span>
            </button>
          {/each}
        </div>

        <div class="dl-divider"></div>

        <div class="dl-version-row">
          <span class="dl-version-label">Текущая версия</span>
          <span class="dl-version-value">v1.4.2</span>
        </div>

        <div class="dl-reqs">
          <p class="dl-reqs-title">Системные требования</p>
          <ul class="dl-reqs-list">
            <li class="dl-req" data-platform="mac" hidden={selected !== 'mac'}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="13" rx="2"></rect><line x1="9" y1="20" x2="15" y2="20"></line><line x1="12" y1="17" x2="12" y2="20"></line></svg>
              macOS 12 Monterey и новее
            </li>
            <li class="dl-req" data-platform="win" hidden={selected !== 'win'}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"></rect><line x1="3" y1="9" x2="21" y2="9"></line></svg>
              Windows 10 и 11 · 64-bit
            </li>
          </ul>
        </div>

        <div class="dl-divider"></div>

        <div class="dl-unsigned">
          <p class="dl-unsigned-title">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"></circle><line x1="12" y1="11" x2="12" y2="16.5"></line><line x1="12" y1="7.6" x2="12" y2="7.7"></line></svg>
            Приложение не подписано
          </p>
          <p class="dl-unsigned-note" data-platform="win" hidden={selected !== 'win'}><span class="dl-unsigned-os">Windows.</span> SmartScreen может показать «Приложение не проверено» — нажмите «Подробнее» → «Выполнить в любом случае».</p>
          <div class="dl-unsigned-mac" data-platform="mac" hidden={selected !== 'mac'}>
            <p class="dl-unsigned-note"><span class="dl-unsigned-os">macOS.</span> После установки выполните в Терминале:</p>
            <div class={`dl-cmd${copied ? ' is-copied' : ''}`}>
              <code class="dl-cmd-text" id="dlCmd">{QUARANTINE_CMD}</code>
              <button class="dl-cmd-copy" id="dlCopyButton" type="button" onclick={copyQuarantineCommand}>
                <span class="dl-cmd-copy-icon" id="dlCopyIcon" aria-hidden="true">
                  {#if copied}
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><polyline points="5 12 10 17 19 7"></polyline></svg>
                  {:else}
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"></rect><path d="M5 15 V5 a2 2 0 0 1 2-2 h10"></path></svg>
                  {/if}
                </span>
                <span id="dlCopyLabel">{copied ? 'Скопировано' : 'Копировать'}</span>
              </button>
            </div>
          </div>
        </div>
      </aside>
    </div>
  </main>
</div>
