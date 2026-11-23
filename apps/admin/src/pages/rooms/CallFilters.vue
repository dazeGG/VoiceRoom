<script setup lang="ts">
import { X } from '@lucide/vue';
import { shortGuestId } from '../../origin.ts';
import { Button } from '../../ui';
import { toggledFilter, type CallOriginFilters } from './call-filters.ts';

defineProps<{ filters: CallOriginFilters }>();
const emit = defineEmits<{ change: [filters: CallOriginFilters] }>();
</script>

<template>
  <Button
    v-if="filters.ipKey"
    size="sm"
    variant="soft"
    :title="`Ключ адреса ${filters.ipKey}`"
    :aria-label="`IP ${filters.ipKey.slice(0, 6)} Снять фильтр по IP`"
    @click="emit('change', toggledFilter(filters, 'ipKey', filters.ipKey ?? ''))"
  >
    IP {{ filters.ipKey.slice(0, 6) }}
    <X aria-hidden="true" />
  </Button>
  <Button
    v-if="filters.clientId"
    size="sm"
    variant="soft"
    :title="`ID браузера / приложения ${filters.clientId}`"
    :aria-label="`ID ${shortGuestId(filters.clientId)} Снять фильтр по ID`"
    @click="emit('change', toggledFilter(filters, 'clientId', filters.clientId ?? ''))"
  >
    ID {{ shortGuestId(filters.clientId) }}
    <X aria-hidden="true" />
  </Button>
</template>
