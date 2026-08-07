<script lang="ts">
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
      <span>{label(member)}</span>
      <small>@{member.login}{member.role === 'owner' ? ' · Создатель' : ''}</small>
    </button>
  {/each}
</div>

<style>
  .mention-menu { position: absolute; z-index: 20; left: 18px; right: 18px; bottom: calc(100% - 8px); display: grid; width: auto; max-height: 280px; overflow: auto; padding: 6px; border: 1px solid var(--line); border-radius: 12px; background: var(--paper); box-shadow: var(--shadow); }
  button { display: grid; gap: 2px; padding: 8px 10px; border: 0; border-radius: 8px; background: transparent; color: inherit; text-align: left; }
  button.active, button:hover { background: color-mix(in oklch, var(--paper), var(--ink) 8%); }
  small { color: var(--muted); }
</style>
