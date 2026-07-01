<script lang="ts">
  import ParticipantContextMenu from './ParticipantContextMenu.svelte';
  import ParticipantTile from './ParticipantTile.svelte';
  import { getSortedParticipants } from '../participants-ui.svelte';

  const participants = $derived(getSortedParticipants());
</script>

{#each participants as participant (participant.id)}
  <ParticipantTile {participant} />
{/each}

<ParticipantContextMenu />