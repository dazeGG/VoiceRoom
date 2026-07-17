<script lang="ts">
  import ParticipantTile from './ParticipantTile.svelte';
  import { getSortedParticipants } from '../participants-ui.svelte';
  import type { Participant } from '../client/core/types';

  let { participants: supplied, variant = 'grid' }: { participants?: Participant[]; variant?: 'grid' | 'strip' } = $props();
  const participants = $derived(supplied ?? getSortedParticipants());
</script>

{#each participants as participant (participant.id)}
  <ParticipantTile {participant} {variant} />
{/each}
