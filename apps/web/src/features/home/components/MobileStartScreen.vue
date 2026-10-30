<script setup lang="ts">
import { ArrowRight, MessageSquare, Mic, MonitorPlay } from '@lucide/vue';
import { ref } from 'vue';
import { createRoom } from '@/api/rooms';
import { markInAppRoomNavigation } from '@/platform/open-in-app';
import { Button, MascotIcon } from '@/shared/ui';
import { iconMd, iconSm } from '@/shared/ui/icons';

const emit = defineEmits<{ toast: [message: string] }>();

const creating = ref(false);

// A phone may run the room page, so `/` offers the one thing it can start:
// a temporary room, joined as a guest. Permanent rooms, the lobby, friends
// and push stay behind the desktop boundary.
async function createTempRoom(): Promise<void> {
  if (creating.value) return;
  creating.value = true;
  try {
    const roomId = await createRoom({ isStatic: false });
    markInAppRoomNavigation();
    window.location.href = `/r/${encodeURIComponent(roomId)}`;
  } catch (error) {
    creating.value = false;
    emit('toast', error instanceof Error && error.message ? error.message : 'Не удалось создать комнату');
  }
}
</script>

<template>
  <main class="mobile-start" aria-labelledby="mobileStartTitle">
    <section class="mobile-start__card">
      <span class="mobile-start__orb"><MascotIcon variant="look" :size="52" /></span>
      <p class="mobile-start__kicker">Комната по ссылке за секунду</p>
      <h1 id="mobileStartTitle" class="mobile-start__title">Голосовая комната прямо в браузере</h1>
      <p class="mobile-start__lead">
        Создайте временную комнату и отправьте ссылку друзьям. Имя и регистрация не нужны.
      </p>

      <Button class="mobile-start__create" variant="primary" type="button" :disabled="creating" @click="createTempRoom">
        <span v-if="creating" class="mobile-start__spinner" aria-hidden="true"></span>
        {{ creating ? 'Создаём…' : 'Создать комнату' }}
        <ArrowRight v-if="!creating" v-bind="iconMd" aria-hidden="true" />
      </Button>

      <ul class="mobile-start__features">
        <li class="mobile-start__feature"><Mic v-bind="iconSm" aria-hidden="true" /> Голос</li>
        <li class="mobile-start__feature"><MessageSquare v-bind="iconSm" aria-hidden="true" /> Чат комнаты</li>
        <li class="mobile-start__feature"><MonitorPlay v-bind="iconSm" aria-hidden="true" /> Чужой экран</li>
      </ul>

      <p class="mobile-start__note">
        Комната живёт, пока в ней есть люди. Свои комнаты, друзья и личные сообщения — на компьютере или в приложении.
      </p>
    </section>
  </main>
</template>
