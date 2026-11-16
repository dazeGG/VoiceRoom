<script setup lang="ts">
import RoomMemberList from '../../src/entities/room/components/RoomMemberList.vue';
import { useSessionStore } from '../../src/features/auth/session.store';
import { useRoomMembershipStore } from '../../src/entities/room/room-membership.store';
import { authUser } from '../fixtures/users';
const session = useSessionStore();
void session.loadSession();
</script>
<template>
  <button @click="session.setUser(authUser({ id: '22222222-2222-4222-8222-222222222222', displayName: 'B' }))">
    Switch to B
  </button>
  <button @click="useRoomMembershipStore().loadRoomMembership('room')">Reload roster</button>
  <RoomMemberList room-id="room" />
</template>
