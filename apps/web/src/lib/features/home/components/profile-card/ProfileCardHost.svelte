<script lang="ts">
  // Binds the presentational ProfileCard to the account's social graph and the
  // shared open/close store. The lobby mounts it, inside the context that
  // provides that graph; without one every person is a stranger.
  import { ContextMenu } from '$lib/shared/ui';
  import { ProfileCard, type ProfileCardRelationship } from '$lib/shared/components/profile-card';
  import { session } from '$lib/features/auth/session.svelte';
  import { closeProfileCard, profileCardUi } from '../../../../entities/profile-card/profile-card-ui.svelte';
  import { useRoomSocial } from '$lib/features/room/social';

  const social = useRoomSocial();

  let { onToast }: { onToast?: (message: string) => void } = $props();

  let busy = $state(false);

  const person = $derived(profileCardUi.person);
  const relationship = $derived<ProfileCardRelationship>(
    person?.userId && person.userId === session.user?.id
      ? 'self'
      : person?.userId
        ? social.relationship(person.userId)
        : 'unavailable'
  );
  const friendsSince = $derived(
    person?.userId ? (social.friends().find((entry) => entry.user.id === person.userId)?.friendsSince ?? null) : null
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
      social.showFriends();
      await social.openDm(userId);
    }, 'Не удалось открыть личные сообщения');
  }

  function addFriend(): void {
    const userId = person?.userId;
    if (!userId) return;
    void run(async () => {
      const result = await social.addFriend(userId);
      onToast?.(result.status === 'accepted' ? 'Теперь вы друзья' : 'Заявка в друзья отправлена');
    }, 'Не удалось отправить заявку в друзья');
  }

  function acceptRequest(): void {
    const userId = person?.userId;
    if (!userId) return;
    void run(async () => {
      await social.acceptRequest(userId);
      onToast?.('Заявка принята');
    }, 'Не удалось принять заявку');
  }

  function dropFriend(): void {
    const userId = person?.userId;
    if (!userId) return;
    void run(async () => {
      await social.removeFriend(userId);
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
