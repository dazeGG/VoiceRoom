<script setup lang="ts">
import { Phone, PhoneCall, PhoneForwarded } from '@lucide/vue';
import type { CallEntryMode } from './use-call-entry';

defineProps<{ mode: CallEntryMode }>();
</script>

<template>
  <PhoneCall v-if="mode === 'return'" aria-hidden="true" />
  <PhoneForwarded v-else-if="mode === 'join'" aria-hidden="true" />
  <Phone v-else aria-hidden="true" />
</template>
