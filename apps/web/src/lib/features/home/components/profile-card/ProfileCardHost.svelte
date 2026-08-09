<script lang="ts">
  // Binds the presentational ProfileCard to the friends model and the shared
  // open/close store. Mounted once per app surface (lobby and room) so each can
  // route toasts to its own stack.
  import { ContextMenu } from '$lib/shared/ui';
  import { ProfileCard, type ProfileCardRelationship } from '$lib/shared/components/profile-card';
  import { session } from '$lib/features/auth/session.svelte';
  import { closeProfileCard, profileCardUi } from '../../profile-card-ui.svelte';
  import {
    acceptRequestByUserId,
    addFriendByUserId,
    friendsState,
    getFriendRelationship,
    openDm,
    removeFriend,
    setMode
  } from '../../model/friends.svelte';

  let { onToast }: { onToast?: (message: string) => void } = $props();

  let busy = $state(false);

  const person = $derived(profileCardUi.person);
  const relationship = $derived<ProfileCardRelationship>(
    person?.userId && person.userId === session.user?.id
      ? 'self'
      : person?.userId
        ? getFriendRelationship(person.userId)
        : 'unavailable'
  );
  const friendsSince = $derived(
    person?.userId
      ? friendsState.friends.find((entry) => entry.user.id === person.userId)?.friendsSince ?? null
      : null
  );

  // Every action closes the card first: the result shows up in the list or the
  // DM view behind it, and leaving a stale card open would contradict it.
  async function run(action: () => Promise<void>, failure: string): Promise<void> {
    if (busy) return;
    busy = true;
    closeProfileCard(false);
    try {
      await action();
    } catch (error) {
      onToast?.(error instanceof Error && error.message ? error.message : failure);
    } finally {
      busy = false;
    }
  }

  function message(): void {
    const userId = person?.userId;
    if (!userId) return;
    void run(async () => {
      setMode('friends');
      await openDm(userId);
    }, 'Не удалось открыть личные сообщения');
  }

  function addFriend(): void {
    const userId = person?.userId;
    if (!userId) return;
    void run(async () => {
      const result = await addFriendByUserId(userId);
      onToast?.(result.status === 'accepted' ? 'Теперь вы друзья' : 'Заявка в друзья отправлена');
    }, 'Не удалось отправить заявку в друзья');
  }

  function acceptRequest(): void {
    const userId = person?.userId;
    if (!userId) return;
    void run(async () => {
      await acceptRequestByUserId(userId);
      onToast?.('Заявка принята');
    }, 'Не удалось принять заявку');
  }

  function dropFriend(): void {
    const userId = person?.userId;
    if (!userId) return;
    void run(async () => {
      await removeFriend(userId);
      onToast?.(`${person?.name ?? 'Пользователь'} удалён из друзей`);
    }, 'Не удалось удалить друга');
  }
</script>

{#if person}
  <ContextMenu
    open={profileCardUi.open}
    x={profileCardUi.x}
    y={profileCardUi.y}
    ariaLabel={`Профиль ${person.name}`}
    restoreFocus={profileCardUi.restoreFocus}
    role="dialog"
    padded={false}
    onClose={() => closeProfileCard(false)}
  >
    {#snippet content()}
      <ProfileCard
        {person}
        {relationship}
        {friendsSince}
        {busy}
        onMessage={message}
        onAddFriend={addFriend}
        onAcceptRequest={acceptRequest}
        onRemoveFriend={dropFriend}
      />
    {/snippet}
  </ContextMenu>
{/if}
