<script setup lang="ts">
import { computed } from 'vue';
import { deviceLabel, shortGuestId, shortIpKey } from '../../origin.ts';
import type { Seat } from './room-bits.ts';
import type { OriginPick } from './call-filters.ts';
import ClientIcon from './ClientIcon.vue';
import OriginToken from './OriginToken.vue';

const props = defineProps<{ seat: Seat; pick?: OriginPick | undefined; shared?: boolean }>();
const clientId = computed(() => props.seat.clientId ?? props.seat.guestId);
const line = computed(() => [deviceLabel(props.seat), props.seat.location].filter(Boolean).join(' · '));
const codes = computed(() => Boolean(props.seat.ipKey || clientId.value || props.pick));
</script>

<template>
  <span v-if="line || seat.client || codes" class="admin-origin">
    <span v-if="line || seat.client" class="admin-origin__line">
      <ClientIcon :client="seat.client" />
      <span v-if="line" class="admin-origin__text">{{ line }}</span>
    </span>
    <span v-if="codes" class="admin-origin__codes">
      <OriginToken
        v-if="seat.ipKey"
        label="Ключ адреса"
        :value="seat.ipKey"
        :short="shortIpKey(seat.ipKey)"
        field="ipKey"
        :pick="pick"
        :shared="shared"
      />
      <span v-else class="admin-origin__token admin-origin__token--none">нет IP</span>
      <OriginToken
        v-if="clientId"
        :label="seat.clientId ? 'ID браузера / приложения' : 'Браузер гостя'"
        :value="clientId"
        :short="shortGuestId(clientId)"
        field="clientId"
        :pick="pick"
      />
    </span>
  </span>
</template>
