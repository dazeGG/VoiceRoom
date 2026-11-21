<script setup lang="ts">
import type { RoomAccount } from '@voice-room/shared/contracts/admin';
import { AccountBadge, Button } from '../../ui';
import { nameOf } from './room-bits.ts';

withDefaults(defineProps<{ account: RoomAccount; withLogin?: boolean; loginOnly?: boolean }>(), { withLogin: true });
const emit = defineEmits<{ open: [accountId: string] }>();
</script>

<template>
  <Button
    size="sm"
    variant="plain"
    class="admin-room-account"
    :title="loginOnly ? nameOf(account) : undefined"
    @click.stop="emit('open', account.id)"
  >
    <span v-if="!loginOnly" class="admin-room-account__name">{{ nameOf(account) }}</span>
    <AccountBadge v-if="!loginOnly" :user-id="account.id" />
    <span v-if="withLogin || loginOnly" class="admin-room-account__login">@{{ account.login }}</span>
  </Button>
</template>
