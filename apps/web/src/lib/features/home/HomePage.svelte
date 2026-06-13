<script lang="ts">
  import { onMount } from 'svelte';
  import { createRoom } from '$lib/api/rooms';
  import { fetchDesktopRelease, type DesktopRelease } from '$lib/api/desktop';
  import FeatureList from '$lib/components/FeatureList.svelte';
  import Topbar from '$lib/components/Topbar.svelte';
  import '$lib/components/typography.css';
  import '$lib/features/room/client/styles.css';
  import { START_FEATURES } from './features';
  import { extractRoomId } from '$lib/utils/room';
  import { cleanDisplayName } from '$lib/utils/text';

  const QUARANTINE_CMD = 'sudo xattr -rd com.apple.quarantine /Applications/Voice\\ Room.app';
  const RELEASES_URL = 'https://github.com/dazeGG/VoiceRoomDesktop/releases/latest';

  const BUILDS = [
    { id: 'mac-arm64', label: 'macOS · Apple Silicon', ext: '.dmg', req: 'macOS 12+', mac: true },
    { id: 'mac-x64', label: 'macOS · Intel', ext: '.dmg', req: 'macOS 12+', mac: true },
    { id: 'win-x64', label: 'Windows · 64-bit', ext: '.exe', req: 'Windows 10/11', mac: false }
  ];

  let savedName = $state('');
  let nameInput = $state('');
  let roomCode = $state('');
  let creating = $state(false);
  let toast = $state('');
  let toastTimer = 0;

  let selectedBuildId = $state('mac-arm64');
  let appOpen = $state(false);
  let appDownloadState = $state<'idle' | 'loading' | 'done'>('idle');
  let cmdCopied = $state(false);
  let copyResetTimer = 0;
  let downloadTimer = 0;
  let downloadResetTimer = 0;

  let release = $state<DesktopRelease | null>(null);
  let releaseLoading = $state(false);
  let releaseError = $state(false);

  // The room step is gated on an explicitly saved name: it unlocks only while
  // the input still matches what was saved (editing re-locks it).
  const nameMatchesSaved = $derived(Boolean(savedName) && cleanDisplayName(nameInput) === savedName);
  const selectedBuild = $derived(BUILDS.find((build) => build.id === selectedBuildId) ?? BUILDS[0]);
  const selectedAsset = $derived(release?.assets[selectedBuildId] ?? null);

  onMount(() => {
    document.body.dataset.screen = 'start';
    savedName = cleanDisplayName(localStorage.getItem('voice-room:name'));
    nameInput = savedName;
    selectedBuildId = detectBuildId();
    return () => {
      delete document.body.dataset.screen;
      window.clearTimeout(toastTimer);
      window.clearTimeout(copyResetTimer);
      window.clearTimeout(downloadTimer);
      window.clearTimeout(downloadResetTimer);
    };
  });

  function detectBuildId(): string {
    try {
      const ua = `${navigator.userAgent || ''} ${navigator.platform || ''}`;
      if (/Win/i.test(ua)) return 'win-x64';
    } catch {
      // Default to Apple Silicon below.
    }
    return 'mac-arm64';
  }

  async function ensureRelease(): Promise<void> {
    if (release || releaseLoading) return;
    releaseLoading = true;
    releaseError = false;
    try {
      release = await fetchDesktopRelease();
    } catch {
      releaseError = true;
    } finally {
      releaseLoading = false;
    }
  }

  function triggerDownload(url: string): void {
    const link = document.createElement('a');
    link.href = url;
    link.rel = 'noopener';
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  function handleAppDownload(): void {
    if (appDownloadState === 'loading' || releaseLoading) return;
    const asset = selectedAsset;
    if (!asset) {
      void ensureRelease();
      return;
    }

    appDownloadState = 'loading';
    triggerDownload(asset.url);

    window.clearTimeout(downloadTimer);
    downloadTimer = window.setTimeout(() => {
      appDownloadState = 'done';
    }, 1200);

    window.clearTimeout(downloadResetTimer);
    downloadResetTimer = window.setTimeout(() => {
      appDownloadState = 'idle';
    }, 4800);
  }

  function appMeta(): string {
    if (releaseLoading) return 'Получаем последний релиз…';
    if (releaseError) return 'Не удалось получить релиз — откройте страницу загрузок.';
    const size = selectedAsset ? `~${Math.round(selectedAsset.size / (1024 * 1024))} МБ` : '';
    const version = release ? `v${release.version}` : '';
    return [selectedBuild.ext, size, selectedBuild.req, version].filter(Boolean).join(' · ');
  }

  async function copyQuarantineCommand(): Promise<void> {
    try {
      await navigator.clipboard?.writeText(QUARANTINE_CMD);
    } catch {
      // Clipboard may be unavailable; still show feedback.
    }

    cmdCopied = true;
    window.clearTimeout(copyResetTimer);
    copyResetTimer = window.setTimeout(() => {
      cmdCopied = false;
    }, 2000);
  }

  function appDownloadLabel(): string {
    if (appDownloadState === 'loading') return 'Загрузка…';
    if (appDownloadState === 'done') return 'Загрузка началась';
    return 'Скачать приложение';
  }

  function toggleApp(): void {
    appOpen = !appOpen;
    if (appOpen) void ensureRelease();
  }

  function saveName(event?: Event): void {
    event?.preventDefault();
    const nextName = cleanDisplayName(nameInput);
    if (!nextName) {
      showToast('Введите имя');
      return;
    }
    savedName = nextName;
    nameInput = nextName;
    localStorage.setItem('voice-room:name', nextName);
  }

  async function handleCreateRoom(): Promise<void> {
    if (!nameMatchesSaved || creating) return;

    creating = true;
    try {
      const roomId = await createRoom();
      openRoom(roomId);
    } catch (error) {
      console.error(error);
      showToast(error instanceof Error && error.message ? error.message : 'Не удалось создать комнату');
    } finally {
      creating = false;
    }
  }

  function handleJoinRoom(): void {
    if (!nameMatchesSaved) return;
    const roomId = extractRoomId(roomCode);
    if (!roomId) {
      showToast('Введите код комнаты');
      return;
    }
    openRoom(roomId);
  }

  function handleRoomCodeKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    handleJoinRoom();
  }

  function openRoom(roomId: string): void {
    window.location.href = `/r/${encodeURIComponent(roomId)}`;
  }

  function showToast(message: string): void {
    toast = message;
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
      toast = '';
    }, 2600);
  }
</script>

<div class="app-shell">
  <Topbar label="Новая голосовая комната" />

  <main class="start-layout" id="startScreen" aria-label="Стартовый экран">
    <section class="start-copy" aria-labelledby="startTitle">
      <p class="eyebrow">voice room</p>
      <h1 class="hero-title" id="startTitle">Голосовая комната без лишних дверей</h1>
      <p class="hero-lead">Сначала сохраните имя, потом создайте комнату или зайдите к своим по коду.</p>

      <FeatureList items={START_FEATURES} />
    </section>

    <div class="home-side">
      <!-- Primary card: name → room, gated steps -->
      <section class="home-card" aria-label="Создать или найти комнату">
        <!-- Step 1 — name -->
        <div class="home-step">
          <span class="home-badge" data-done={nameMatchesSaved}>
            {#if nameMatchesSaved}
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="5 12 10 17 19 7"></polyline></svg>
            {:else}
              1
            {/if}
          </span>
          <span class="home-step-label">Ваше имя</span>
        </div>

        <form class="home-field-row" onsubmit={saveName}>
          <input
            class="home-input"
            maxlength="40"
            autocomplete="name"
            placeholder="Как вас звать"
            required
            bind:value={nameInput}
          >
          <button class="home-ghost-button" type="submit">{nameMatchesSaved ? 'Сохранено' : 'Сохранить'}</button>
        </form>
        <p class="home-hint" class:home-hint--saved={nameMatchesSaved}>
          {#if nameMatchesSaved}
            Сохранено как&nbsp;<b>{savedName}</b>&nbsp;· только на этом устройстве
          {:else}
            Хранится только на вашем устройстве — без регистрации.
          {/if}
        </p>

        <div class="home-rule"></div>

        <!-- Step 2 — room -->
        <div class="home-step">
          <span class="home-badge" data-dim={!nameMatchesSaved}>2</span>
          <span class="home-step-label" data-dim={!nameMatchesSaved}>Комната</span>
          {#if !nameMatchesSaved}
            <span class="home-lock">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2"></rect><path d="M8 11 V8 a4 4 0 0 1 8 0 v3"></path></svg>
              сначала имя
            </span>
          {/if}
        </div>

        <div class="home-room" data-locked={!nameMatchesSaved} inert={!nameMatchesSaved}>
          <button class="home-create" type="button" disabled={creating} onclick={handleCreateRoom}>
            {#if creating}
              <span class="home-spinner" aria-hidden="true"></span>
            {:else}
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
            {/if}
            {creating ? 'Создаём…' : 'Создать комнату'}
          </button>

          <div class="home-or"><span>или войдите по коду</span></div>

          <div class="home-field-row">
            <input
              class="home-input home-input--code"
              maxlength="120"
              autocapitalize="off"
              autocomplete="off"
              spellcheck="false"
              placeholder="x7m2kq9p"
              bind:value={roomCode}
              onkeydown={handleRoomCodeKeydown}
            >
            <button class="home-ghost-button" type="button" onclick={handleJoinRoom}>Войти</button>
          </div>
        </div>
      </section>

      <!-- Secondary card: desktop app (collapsible, de-emphasized) -->
      <section class="home-app" data-open={appOpen} aria-label="Десктоп-приложение">
        <button class="home-app-head" type="button" aria-expanded={appOpen} onclick={toggleApp}>
          <span class="home-app-head-main">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#9a9484" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="13" rx="2"></rect><line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="17" x2="12" y2="21"></line></svg>
            <span>
              <span class="home-app-title">Десктоп-приложение</span>
              <span class="home-app-sub">Своё окно и горячие клавиши · macOS и Windows</span>
            </span>
          </span>
          <span class="home-app-chevron" aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
          </span>
        </button>

        {#if appOpen}
          <div class="home-app-body">
            <div>
              <div class="home-app-fieldlabel">Платформа</div>
              <div class="home-select-wrap">
                <select class="home-select" bind:value={selectedBuildId}>
                  {#each BUILDS as build}
                    <option value={build.id}>{build.label}</option>
                  {/each}
                </select>
                <span class="home-select-chevron" aria-hidden="true">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
                </span>
              </div>
            </div>

            {#if releaseError}
              <a class="home-dl" href={RELEASES_URL} target="_blank" rel="noopener">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
                Открыть страницу загрузок
              </a>
            {:else}
              <button class="home-dl" type="button" disabled={releaseLoading || appDownloadState === 'loading'} onclick={handleAppDownload}>
                {#if appDownloadState === 'loading' || releaseLoading}
                  <span class="home-spinner" aria-hidden="true"></span>
                {:else if appDownloadState === 'done'}
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#7ec99a" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="5 12 10 17 19 7"></polyline></svg>
                {:else}
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="12" y1="4" x2="12" y2="15"></line><polyline points="7 11 12 16 17 11"></polyline><line x1="5" y1="20" x2="19" y2="20"></line></svg>
                {/if}
                {appDownloadLabel()}
              </button>
            {/if}

            <p class="home-app-meta">{appMeta()}</p>

            {#if selectedBuild.mac}
              <div>
                <p class="home-cmd-label">Приложение не подписано. После установки выполните в Терминале:</p>
                <div class="home-cmd">
                  <code>{QUARANTINE_CMD}</code>
                  <button class="home-cmd-copy" type="button" onclick={copyQuarantineCommand}>
                    {#if cmdCopied}
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#7ec99a" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="5 12 10 17 19 7"></polyline></svg>
                    {:else}
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"></rect><path d="M5 15 V5 a2 2 0 0 1 2-2 h10"></path></svg>
                    {/if}
                    {cmdCopied ? 'Скопировано' : 'Копировать'}
                  </button>
                </div>
              </div>
            {:else}
              <p class="home-app-note">Приложение не подписано. Если SmartScreen покажет «Приложение не проверено» — нажмите «Подробнее» → «Выполнить в любом случае».</p>
            {/if}
          </div>
        {/if}
      </section>
    </div>
  </main>
</div>

{#if toast}
  <div class="toast is-visible" role="status" aria-live="polite">{toast}</div>
{/if}

<style>
  /* Right block — stepped primary card (name → room) + collapsible app card.
     Implements the «Voice Room - Главная» design handoff. Scoped so the warm
     panel values win over the global input/select rules in styles.css. */
  .home-side {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  /* Primary card */
  .home-card {
    display: flex;
    flex-direction: column;
    border: 1px solid rgba(255, 255, 255, 0.09);
    border-radius: 20px;
    padding: 6px 24px 24px;
    background: rgba(255, 255, 255, 0.04);
  }

  .home-step {
    display: flex;
    align-items: center;
    gap: 11px;
    padding: 18px 0 14px;
  }

  .home-badge {
    flex: none;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border-radius: 50%;
    border: 1px solid rgba(255, 255, 255, 0.14);
    background: #1b1a14;
    color: #cfc9ba;
    font-family: var(--font-mono);
    font-size: 12px;
  }

  .home-badge[data-done='true'] {
    border-color: rgba(79, 174, 116, 0.5);
    background: rgba(79, 174, 116, 0.16);
    color: #7ec99a;
  }

  .home-badge[data-dim='true'] {
    border-color: rgba(255, 255, 255, 0.07);
    background: rgba(255, 255, 255, 0.02);
    color: #5a5547;
  }

  .home-step-label {
    font-family: var(--font-mono);
    font-size: 12px;
    letter-spacing: 0.14em;
    color: #9a9484;
    text-transform: uppercase;
    white-space: nowrap;
  }

  .home-step-label[data-dim='true'] {
    color: #5a5547;
  }

  .home-lock {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: 5px;
    color: #6f6a5c;
    font-size: 11px;
  }

  .home-field-row {
    display: flex;
    gap: 8px;
  }

  .home-input {
    flex: 1;
    min-width: 0;
    min-height: 0;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 12px;
    padding: 13px 15px;
    background: #0c0b08;
    color: #ece7d9;
    font-family: var(--font-sans);
    font-size: 15px;
    outline: none;
    transition: border-color 0.15s ease;
  }

  .home-input::placeholder {
    color: #6f6a5c;
  }

  .home-input:hover {
    border-color: rgba(255, 255, 255, 0.16);
    background: #0c0b08;
  }

  .home-input:focus {
    border-color: rgba(154, 143, 106, 0.7);
  }

  .home-input--code {
    font-family: var(--font-mono);
    letter-spacing: 0.04em;
  }

  .home-ghost-button {
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 7px;
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 12px;
    padding: 0 16px;
    background: rgba(255, 255, 255, 0.05);
    color: #ece7d9;
    font-family: var(--font-sans);
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.15s ease;
  }

  .home-ghost-button:hover {
    background: rgba(255, 255, 255, 0.1);
  }

  .home-hint {
    min-height: 18px;
    margin: 9px 0 0;
    display: flex;
    align-items: center;
    color: #6f6a5c;
    font-size: 12.5px;
  }

  .home-hint--saved {
    color: #7d7768;
  }

  .home-hint b {
    color: #a9c9b6;
    font-weight: 600;
  }

  .home-rule {
    height: 1px;
    margin-top: 18px;
    background: rgba(255, 255, 255, 0.07);
  }

  .home-room {
    display: flex;
    flex-direction: column;
    gap: 14px;
    transition: opacity 0.2s ease;
  }

  .home-room[data-locked='true'] {
    opacity: 0.4;
    pointer-events: none;
  }

  .home-create {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 9px;
    width: 100%;
    border: none;
    border-radius: 12px;
    padding: 15px;
    background: #d9d3c3;
    color: #17150f;
    font-family: var(--font-sans);
    font-size: 15px;
    font-weight: 700;
    letter-spacing: -0.01em;
    cursor: pointer;
    transition: background 0.15s ease;
  }

  .home-create:hover {
    background: #e7e1d1;
  }

  .home-create:disabled {
    cursor: default;
    opacity: 0.8;
  }

  .home-create .home-spinner {
    border-color: rgba(23, 21, 15, 0.25);
    border-top-color: #17150f;
  }

  .home-or {
    display: flex;
    align-items: center;
    gap: 12px;
    color: #6f6a5c;
    font-size: 12px;
  }

  .home-or::before,
  .home-or::after {
    content: '';
    flex: 1;
    height: 1px;
    background: rgba(255, 255, 255, 0.07);
  }

  .home-spinner {
    width: 14px;
    height: 14px;
    border-radius: 50%;
    border: 2px solid rgba(236, 231, 217, 0.25);
    border-top-color: #ece7d9;
    animation: home-spin 0.7s linear infinite;
  }

  @keyframes home-spin {
    to {
      transform: rotate(360deg);
    }
  }

  /* Secondary card — collapsible desktop app */
  .home-app {
    border: 1px solid rgba(255, 255, 255, 0.07);
    border-radius: 20px;
    padding: 20px 24px 22px;
    background: rgba(255, 255, 255, 0.02);
  }

  .home-app-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    width: 100%;
    padding: 0;
    border: none;
    background: none;
    color: inherit;
    text-align: left;
    cursor: pointer;
  }

  .home-app-head-main {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .home-app-title {
    display: block;
    color: #cfc9ba;
    font-size: 14px;
    font-weight: 600;
    letter-spacing: -0.01em;
  }

  .home-app-sub {
    display: block;
    margin-top: 2px;
    color: #7d7768;
    font-size: 12.5px;
  }

  .home-app-chevron {
    display: inline-flex;
    color: #7d7768;
    transition: transform 0.2s ease;
  }

  .home-app[data-open='true'] .home-app-chevron {
    transform: rotate(180deg);
  }

  .home-app-body {
    margin-top: 18px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .home-app-fieldlabel {
    margin-bottom: 8px;
    font-family: var(--font-mono);
    font-size: 11px;
    letter-spacing: 0.14em;
    color: #6f6a5c;
    text-transform: uppercase;
  }

  .home-select-wrap {
    position: relative;
  }

  .home-select {
    width: 100%;
    min-height: 0;
    -webkit-appearance: none;
    -moz-appearance: none;
    appearance: none;
    border: 1px solid rgba(154, 143, 106, 0.55);
    border-radius: 12px;
    padding: 13px 40px 13px 15px;
    background: #0c0b08;
    color: #ece7d9;
    font-family: var(--font-sans);
    font-size: 14px;
    font-weight: 500;
    outline: none;
    cursor: pointer;
  }

  .home-select:hover {
    border-color: rgba(154, 143, 106, 0.7);
    background: #0c0b08;
  }

  .home-select option {
    background: #16140f;
    color: #ece7d9;
  }

  .home-select-chevron {
    position: absolute;
    right: 14px;
    top: 50%;
    transform: translateY(-50%);
    pointer-events: none;
    display: inline-flex;
    color: #9a9484;
  }

  .home-dl {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 9px;
    width: 100%;
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 12px;
    padding: 14px;
    background: rgba(255, 255, 255, 0.05);
    color: #ece7d9;
    font-family: var(--font-sans);
    font-size: 14px;
    font-weight: 600;
    text-decoration: none;
    cursor: pointer;
    transition: background 0.15s ease;
  }

  .home-dl:disabled {
    cursor: default;
    opacity: 0.7;
  }

  .home-dl:hover {
    background: rgba(255, 255, 255, 0.1);
  }

  .home-app-meta {
    margin: 0;
    font-family: var(--font-mono);
    font-size: 11.5px;
    letter-spacing: 0.02em;
    color: #6f6a5c;
  }

  .home-app-note {
    margin: 2px 0 0;
    color: #8c8576;
    font-size: 12px;
    line-height: 1.55;
  }

  .home-cmd-label {
    margin: 0 0 8px;
    color: #8c8576;
    font-size: 12px;
    line-height: 1.5;
  }

  .home-cmd {
    display: flex;
    align-items: stretch;
    gap: 8px;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 11px;
    padding: 10px 11px;
    background: #0c0b08;
  }

  .home-cmd code {
    flex: 1;
    min-width: 0;
    align-self: center;
    font-family: var(--font-mono);
    font-size: 11px;
    line-height: 1.5;
    color: #cfc9ba;
    word-break: break-all;
  }

  .home-cmd-copy {
    flex: none;
    align-self: center;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 8px;
    padding: 6px 10px;
    background: rgba(255, 255, 255, 0.05);
    color: #cfc9ba;
    font-family: var(--font-sans);
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.15s ease;
  }

  .home-cmd-copy:hover {
    background: rgba(255, 255, 255, 0.1);
  }

  @media (prefers-reduced-motion: reduce) {
    .home-spinner {
      animation: none;
    }
  }
</style>
