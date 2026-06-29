<script lang="ts">
  import { friendName } from '../../model/lobby-format';
  import { friendsState, acceptRequest, cancelRequest, declineRequest } from '../../model/friends.svelte';
  import Avatar from './Avatar.svelte';

  let { onToast } = $props<{ onToast: (message: string) => void }>();

  let busy = $state<Record<string, boolean>>({});

  const incoming = $derived(friendsState.requests.incoming);
  const outgoing = $derived(friendsState.requests.outgoing);

  async function run(id: string, action: () => Promise<void>, ok: string): Promise<void> {
    if (busy[id]) return;
    busy = { ...busy, [id]: true };
    try {
      await action();
      onToast(ok);
    } catch (error) {
      onToast(error instanceof Error && error.message ? error.message : 'Не удалось выполнить действие');
    } finally {
      busy = { ...busy, [id]: false };
    }
  }

  function mutualLabel(count: number): string {
    if (count === 0) return 'нет общих друзей';
    const mod10 = count % 10;
    const mod100 = count % 100;
    const word = mod10 === 1 && mod100 !== 11 ? 'общий друг' : mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20) ? 'общих друга' : 'общих друзей';
    return `${count} ${word}`;
  }
</script>

<div class="lobby-view-head">
  <div class="lobby-view-title">Заявки в друзья</div>
  <div class="lobby-view-sub">{incoming.length} входящие · {outgoing.length} исходящая</div>
</div>

<div class="lobby-view-body lobby-scroll">
  <div class="lobby-cols-2">
    <div>
      <div class="lobby-mono" style="font-size:11px;color:#7d7768;margin-bottom:14px;">Входящие — {incoming.length}</div>
      {#if incoming.length === 0}
        <p class="lobby-empty">Новых заявок нет.</p>
      {:else}
        <div class="lobby-req-list">
          {#each incoming as request (request.id)}
            <div class="lobby-req-card">
              <Avatar name={friendName(request.user)} colorKey={request.user.avatarColorKey} size={44} />
              <div style="flex:1;min-width:0;">
                <div class="lobby-req-name-row">
                  <span class="lobby-req-name">{friendName(request.user)}</span>
                  <span class="lobby-req-handle">@{request.user.login}</span>
                </div>
                <div class="lobby-req-meta">{mutualLabel(request.mutualFriends)}</div>
              </div>
              <div class="lobby-req-actions">
                <button class="lobby-req-accept" type="button" title="Принять" disabled={busy[request.id]} onclick={() => run(request.id, () => acceptRequest(request.id), 'Заявка принята')}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="5 12 10 17 19 7"></polyline></svg>
                </button>
                <button class="lobby-req-decline" type="button" title="Отклонить" disabled={busy[request.id]} onclick={() => run(request.id, () => declineRequest(request.id), 'Заявка отклонена')}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="6" y1="6" x2="18" y2="18"></line><line x1="18" y1="6" x2="6" y2="18"></line></svg>
                </button>
              </div>
            </div>
          {/each}
        </div>
      {/if}
    </div>

    <div>
      <div class="lobby-mono" style="font-size:11px;color:#7d7768;margin-bottom:14px;">Исходящие — {outgoing.length}</div>
      {#if outgoing.length === 0}
        <p class="lobby-empty">Вы пока никому не отправляли заявки.</p>
      {:else}
        <div class="lobby-req-list">
          {#each outgoing as request (request.id)}
            <div class="lobby-req-card">
              <Avatar name={friendName(request.user)} colorKey={request.user.avatarColorKey} size={44} />
              <div style="flex:1;min-width:0;">
                <div class="lobby-req-name-row">
                  <span class="lobby-req-name">{friendName(request.user)}</span>
                  <span class="lobby-req-handle">@{request.user.login}</span>
                </div>
                <div class="lobby-req-pending"><span class="lobby-req-pending-dot"></span>заявка отправлена · ждём ответа</div>
              </div>
              <button class="lobby-req-cancel" type="button" disabled={busy[request.id]} onclick={() => run(request.id, () => cancelRequest(request.id), 'Заявка отменена')}>Отменить</button>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  </div>
</div>
