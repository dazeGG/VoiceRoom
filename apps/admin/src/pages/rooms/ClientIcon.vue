<script setup lang="ts">
import { AppWindow, Globe, Smartphone } from '@lucide/vue';
import type { ClientKind } from '@voiceroom/shared/contracts/admin';

defineProps<{ client: ClientKind | null }>();
const clients = {
  desktop_app: { label: 'приложение', icon: AppWindow },
  browser: { label: 'браузер', icon: Globe },
  mobile_app: { label: 'Android', icon: Smartphone },
  mobile: { label: 'телефон', icon: Smartphone }
} satisfies Record<ClientKind, { label: string; icon: typeof AppWindow }>;
</script>

<template>
  <span
    v-if="client"
    class="admin-origin__client"
    :title="clients[client].label"
    :aria-label="clients[client].label"
    role="img"
  >
    <component :is="clients[client].icon" aria-hidden="true" />
  </span>
</template>
