<script lang="ts">
  import EmojiText from '$lib/shared/chat/EmojiText.svelte';
  import { BellOff } from '@lucide/svelte';
  import { onMount } from 'svelte';
  import type { OwnedRoom } from '$lib/api/auth';
  import { fetchBlockedUsers, unblockUser, type PublicUser } from '$lib/api/friends';
  import { Avatar } from '$lib/shared/ui';
  import { iconSm } from '$lib/shared/ui/icons';
  import {
    notificationPreferences,
    requestNotificationsFromUiAction,
    setNotificationsEnabled,
    syncNotificationPermission,
    updatePeerNotificationsMuted,
    updatePrivateNotifications,
    updateRoomNotificationsMuted
  } from '$lib/shared/notifications/preferences.svelte';
  import { showBrowserNotification } from '$lib/shared/notifications/router';
  import { pushNotifications, setPushNotificationsEnabled } from '../../model/push-notifications.svelte';
  import type { SettingsSupport } from '../../model/settings-support';
  import type { ToastOptions } from '../../model/toasts.svelte';

  let {
    support,
    users,
    rooms,
    onToast
  }: {
    support: SettingsSupport;
    users: PublicUser[];
    rooms: OwnedRoom[];
    onToast: (message: string, options?: ToastOptions) => void;
  } = $props();

  let notificationSaving = $state(false);
  let notificationTargetSaving = $state('');
  let blockedUsers = $state<PublicUser[]>([]);
  let blockedUsersLoading = $state(true);
  let blockedUserSaving = $state('');

  const browserNotificationsEnabled = $derived(
    pushNotifications.supported
      ? pushNotifications.active
      : notificationPreferences.notificationsEnabled && notificationPreferences.deliveryPermission === 'granted'
  );
  const notificationToggleLabel = $derived(support.desktopApp ? 'Уведомления приложения' : 'Push этого браузера');

  onMount(() => {
    void loadBlockedUsers();
  });

  function failure(error: unknown, fallback: string): string {
    return error instanceof Error && error.message ? error.message : fallback;
  }

  async function loadBlockedUsers(): Promise<void> {
    blockedUsersLoading = true;
    try {
      blockedUsers = await fetchBlockedUsers();
    } catch (error) {
      onToast(failure(error, 'Не удалось загрузить блокировки'), { variant: 'error' });
    } finally {
      blockedUsersLoading = false;
    }
  }

  async function unblockBlockedUser(userId: string): Promise<void> {
    if (blockedUserSaving) return;
    blockedUserSaving = userId;
    try {
      await unblockUser(userId);
      blockedUsers = blockedUsers.filter((entry) => entry.id !== userId);
      onToast('Пользователь разблокирован');
    } catch (error) {
      onToast(failure(error, 'Не удалось разблокировать'), { variant: 'error' });
    } finally {
      blockedUserSaving = '';
    }
  }

  async function toggleBrowserNotifications(): Promise<void> {
    try {
      if (pushNotifications.supported) {
        await setPushNotificationsEnabled(!pushNotifications.active);
        syncNotificationPermission();
        return;
      }
      if (browserNotificationsEnabled) {
        setNotificationsEnabled(false);
        return;
      }
      const permission = await requestNotificationsFromUiAction();
      if (permission === 'granted') {
        if (support.desktopApp) {
          void showBrowserNotification({
            body: 'Voice Room сможет показывать уведомления, пока приложение открыто.',
            dedupeKey: `settings-notifications-enabled:${Date.now()}`,
            tag: 'settings-notifications-enabled',
            title: 'Уведомления Voice Room включены'
          });
        }
      } else if (permission === 'denied') onToast('Разрешите уведомления в настройках браузера');
      else onToast('Системные уведомления недоступны');
    } catch {
      onToast(
        pushNotifications.serverEnabled
          ? 'Не удалось изменить push-уведомления'
          : 'Push-уведомления не настроены на сервере',
        { variant: 'error' }
      );
    }
  }

  async function togglePrivateNotifications(): Promise<void> {
    if (notificationSaving) return;
    notificationSaving = true;
    try {
      await updatePrivateNotifications(!notificationPreferences.privateNotifications);
    } catch {
      onToast('Не удалось сохранить настройки уведомлений');
    } finally {
      notificationSaving = false;
    }
  }

  async function toggleTarget(key: string, save: () => Promise<unknown>, failureText: string): Promise<void> {
    if (notificationTargetSaving) return;
    notificationTargetSaving = key;
    try {
      await save();
    } catch {
      onToast(failureText);
    } finally {
      notificationTargetSaving = '';
    }
  }

  function togglePeerNotifications(userId: string): Promise<void> {
    const muted = !notificationPreferences.mutedPeerIds.includes(userId);
    return toggleTarget(
      `user:${userId}`,
      () => updatePeerNotificationsMuted(userId, muted),
      'Не удалось изменить уведомления пользователя'
    );
  }

  function toggleRoomNotifications(roomId: string): Promise<void> {
    const muted = !notificationPreferences.mutedRoomIds.includes(roomId);
    return toggleTarget(
      `room:${roomId}`,
      () => updateRoomNotificationsMuted(roomId, muted),
      'Не удалось изменить уведомления комнаты'
    );
  }
</script>

<div class="settings-sound">
  {#if !support.mac}
    <!-- The desktop app keeps this switch in «Приложение». -->
    <div hidden={support.desktopApp && support.autostart}>
      <div class="settings-gate-head">
        <span class="settings-field-label">{notificationToggleLabel}</span>
        <button
          class="settings-switch"
          type="button"
          role="switch"
          aria-checked={browserNotificationsEnabled}
          aria-label={notificationToggleLabel}
          disabled={pushNotifications.busy}
          onclick={() => void toggleBrowserNotifications()}
        >
          <span class="settings-switch-knob" aria-hidden="true"></span>
        </button>
      </div>
      <div class="settings-gate-hint">
        {#if pushNotifications.supported && pushNotifications.active}Включены. События будут доставляться, когда вкладка
          закрыта.
        {:else if pushNotifications.supported && pushNotifications.loaded && !pushNotifications.serverEnabled}Отключены
          на сервере: настройте VAPID-ключи.
        {:else if support.desktopApp && notificationPreferences.deliveryPermission === 'granted'}Включены для открытого
          приложения.
        {:else if notificationPreferences.deliveryPermission === 'granted'}Включены для открытой вкладки.
        {:else if notificationPreferences.browserPermission === 'denied'}Запрещены браузером — измените разрешение
          сайта.
        {:else}Нажмите переключатель, чтобы включить. Запрос выполняется только по вашему действию.{/if}
      </div>
    </div>

    <div class="settings-notification-dependent" data-disabled={!browserNotificationsEnabled}>
      <div class="settings-gate-head">
        <span class="settings-field-label">Приватный текст уведомлений</span>
        <button
          class="settings-switch"
          type="button"
          role="switch"
          aria-checked={notificationPreferences.privateNotifications}
          aria-label="Приватный текст уведомлений"
          disabled={notificationSaving || !browserNotificationsEnabled}
          onclick={() => void togglePrivateNotifications()}
        >
          <span class="settings-switch-knob" aria-hidden="true"></span>
        </button>
      </div>
      <div class="settings-gate-hint">Скрывает текст сообщений в системных уведомлениях.</div>
    </div>
  {/if}

  <div class="settings-notification-ignore">
    <div>
      <span class="settings-section-title">Получать уведомления</span>
      <div class="settings-gate-hint">
        Выберите диалоги и комнаты, от которых хотите получать системные уведомления и звуковые сигналы.
      </div>
    </div>

    <div class="settings-notification-targets">
      <section class="settings-notification-group" aria-labelledby="notificationUsersTitle">
        <span class="settings-field-label" id="notificationUsersTitle">Пользователи</span>
        {#if users.length > 0}
          <div class="settings-notification-list">
            {#each users as peer (peer.id)}
              {@const peerMuted = notificationPreferences.mutedPeerIds.includes(peer.id)}
              {@const peerName = peer.displayName?.trim() || peer.login}
              <div class="settings-notification-row">
                <Avatar
                  name={peerName}
                  src={peer.avatarUrl}
                  colorKey={peer.avatarColorKey}
                  background={peer.avatarAccent || undefined}
                  size={32}
                />
                <span class="settings-notification-name">
                  <span class="settings-notification-title">
                    <strong><EmojiText text={peerName} /></strong>
                    {#if peerMuted}
                      <span
                        class="settings-notification-muted"
                        role="img"
                        aria-label="Уведомления отключены"
                        title="Уведомления отключены"
                      >
                        <BellOff {...iconSm} aria-hidden="true" />
                      </span>
                    {/if}
                  </span>
                  <small>@{peer.login}</small>
                </span>
                <button
                  class="settings-switch"
                  type="button"
                  role="switch"
                  aria-checked={!peerMuted}
                  aria-label={`Получать уведомления от ${peerName}`}
                  disabled={Boolean(notificationTargetSaving)}
                  onclick={() => void togglePeerNotifications(peer.id)}
                >
                  <span class="settings-switch-knob" aria-hidden="true"></span>
                </button>
              </div>
            {/each}
          </div>
        {:else}
          <div class="settings-notification-empty">Диалогов пока нет.</div>
        {/if}
      </section>

      <section class="settings-notification-group" aria-labelledby="notificationRoomsTitle">
        <span class="settings-field-label" id="notificationRoomsTitle">Комнаты</span>
        {#if rooms.length > 0}
          <div class="settings-notification-list">
            {#each rooms as room (room.roomId)}
              {@const roomMuted = notificationPreferences.mutedRoomIds.includes(room.roomId)}
              <div class="settings-notification-row">
                <Avatar
                  name={room.name?.trim() || room.roomId}
                  src={room.avatarUrl}
                  shape="squircle"
                  background="var(--vr-surface-3)"
                  size={32}
                />
                <span class="settings-notification-name">
                  <span class="settings-notification-title">
                    <strong><EmojiText text={room.name?.trim() || 'Комната'} /></strong>
                    {#if roomMuted}
                      <span
                        class="settings-notification-muted"
                        role="img"
                        aria-label="Уведомления отключены"
                        title="Уведомления отключены"
                      >
                        <BellOff {...iconSm} aria-hidden="true" />
                      </span>
                    {/if}
                  </span>
                  <small>{room.roomId}</small>
                </span>
                <button
                  class="settings-switch"
                  type="button"
                  role="switch"
                  aria-checked={!roomMuted}
                  aria-label={`Получать уведомления комнаты ${room.name?.trim() || room.roomId}`}
                  disabled={Boolean(notificationTargetSaving)}
                  onclick={() => void toggleRoomNotifications(room.roomId)}
                >
                  <span class="settings-switch-knob" aria-hidden="true"></span>
                </button>
              </div>
            {/each}
          </div>
        {:else}
          <div class="settings-notification-empty">Сохранённых комнат пока нет.</div>
        {/if}
      </section>
    </div>
  </div>

  <section class="settings-notification-group settings-blocked-users" aria-labelledby="blockedUsersTitle">
    <div>
      <span class="settings-section-title" id="blockedUsersTitle">Заблокированные пользователи</span>
      <div class="settings-gate-hint">Разблокировка не восстанавливает дружбу и историю отношений.</div>
    </div>
    {#if blockedUsersLoading}
      <div class="settings-notification-empty" role="status">Загружаем…</div>
    {:else if blockedUsers.length > 0}
      <div class="settings-notification-list">
        {#each blockedUsers as blocked (blocked.id)}
          {@const blockedName = blocked.displayName?.trim() || blocked.login}
          <div class="settings-notification-row">
            <Avatar
              name={blockedName}
              src={blocked.avatarUrl}
              colorKey={blocked.avatarColorKey}
              background={blocked.avatarAccent || undefined}
              size={32}
            />
            <span class="settings-notification-name">
              <strong><EmojiText text={blockedName} /></strong>
              {#if blocked.login}<small>@{blocked.login}</small>{/if}
            </span>
            <button
              class="settings-unblock-button"
              type="button"
              disabled={Boolean(blockedUserSaving)}
              onclick={() => void unblockBlockedUser(blocked.id)}
            >
              {blockedUserSaving === blocked.id ? 'Разблокируем…' : 'Разблокировать'}
            </button>
          </div>
        {/each}
      </div>
    {:else}
      <div class="settings-notification-empty">Заблокированных пользователей нет.</div>
    {/if}
  </section>
</div>

<style>
  :global(.settings-notification-title) {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }
  :global(.settings-notification-muted) {
    display: inline-flex;
    flex: none;
    color: var(--vr-text-3);
  }
</style>
