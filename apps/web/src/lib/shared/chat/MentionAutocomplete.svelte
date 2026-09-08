<script lang="ts">
  // Picking who to mention is picking a person, so the row carries the face
  // alongside both names: two people can share a display name, and the login is
  // what actually goes into the message.
  import { Avatar } from '$lib/shared/ui';
  import type { MembershipMember } from '@voice-room/shared/membership';

  let { candidates, activeIndex = 0, onselect }: { candidates: MembershipMember[]; activeIndex?: number; onselect: (member: MembershipMember) => void } = $props();
  function label(member: MembershipMember): string { return member.displayName || member.login; }
</script>

<div class="mention-menu" role="listbox" aria-label="Упомянуть участника">
  {#each candidates as member, index (member.userId)}
    <button
      type="button"
      role="option"
      aria-selected={index === activeIndex}
      class:active={index === activeIndex}
      onmousedown={(event) => event.preventDefault()}
      onclick={() => onselect(member)}
    >
      <Avatar
        name={label(member)}
        src={member.avatarUrl}
        colorKey={member.avatarColorKey}
        background={member.avatarAccent}
        size={28}
      />
      <span class="mention-names">
        <span class="mention-name">{label(member)}</span>
        <small>@{member.login}{member.role === 'owner' ? ' · Создатель' : ''}</small>
      </span>
    </button>
  {/each}
</div>

<style>
  .mention-menu { position: absolute; z-index: 20; left: 18px; right: 18px; bottom: calc(100% - 8px); display: grid; width: auto; max-height: 280px; overflow: auto; padding: 6px; border: 1px solid var(--line); border-radius: 12px; background: var(--paper); box-shadow: var(--shadow); }
  button { display: flex; align-items: center; gap: 9px; padding: 6px 10px; border: 0; border-radius: 8px; background: transparent; color: inherit; text-align: left; }
  button.active, button:hover { background: color-mix(in oklch, var(--paper), var(--ink) 8%); }
  .mention-names { display: grid; gap: 1px; min-width: 0; }
  .mention-name, small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  small { color: var(--muted); }
</style>
