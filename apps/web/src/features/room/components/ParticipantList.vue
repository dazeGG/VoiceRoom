<script setup lang="ts">
import { computed } from 'vue';
import type { Participant } from '../client/core/types';
import { useParticipantsUiStore } from '../participants-ui.store';
import ParticipantTile from './ParticipantTile.vue';

const props = withDefaults(defineProps<{ participants?: Participant[] | undefined; variant?: 'grid' | 'strip' }>(), {
  participants: undefined,
  variant: 'grid'
});

const participantsUi = useParticipantsUiStore();
const participants = computed(() => props.participants ?? participantsUi.getSortedParticipants());
</script>

<template>
  <ParticipantTile
    v-for="participant in participants"
    :key="participant.id"
    :participant="participant"
    :variant="variant"
  />
</template>
