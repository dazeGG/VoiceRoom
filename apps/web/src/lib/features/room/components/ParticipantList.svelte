<script lang="ts">
  import ParticipantContextMenu from './ParticipantContextMenu.svelte';
  import ParticipantTile from './ParticipantTile.svelte';
  import { getParticipantCount, getSortedParticipants } from '../participants-ui.svelte';

  const participants = $derived(getSortedParticipants());
  const count = $derived(getParticipantCount());
</script>

<div class="participants" id="participants" data-count={Math.min(count, 9)} aria-live="polite">
  {#each participants as participant (participant.id)}
    <ParticipantTile {participant} />
  {/each}
</div>

<ParticipantContextMenu />