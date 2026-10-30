<script setup lang="ts">
import { ArrowRight } from '@lucide/vue';
import { START_FEATURES } from '@/shared/start-features';
import { Button } from '@/shared/ui';
import { iconMd } from '@/shared/ui/icons';
import LandingFeatureGrid from './LandingFeatureGrid.vue';

defineProps<{ creatingTemp: boolean; joining: boolean }>();

const roomCode = defineModel<string>('roomCode', { required: true });

const emit = defineEmits<{ createTemp: []; join: [] }>();

function onRoomCodeKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Enter') return;
  event.preventDefault();
  emit('join');
}
</script>

<template>
  <section class="landing-hero" aria-labelledby="landingTitle">
    <p class="landing-hero__kicker"><span class="landing-hero__kicker-dot"></span>Комната по ссылке за секунду</p>
    <h1 id="landingTitle" class="landing-hero__title">Голосовые комнаты для своих</h1>
    <p class="landing-hero__lead">
      Нажмите — и вы уже в комнате. Код и ссылка появятся сразу. Аккаунт нужен, только чтобы сохранять комнаты.
    </p>

    <div class="landing-hero__cta-row">
      <Button variant="primary" size="xl" :disabled="creatingTemp" @click="emit('createTemp')">
        <span v-if="creatingTemp" class="home-spinner" aria-hidden="true"></span>
        Создать комнату
        <ArrowRight v-bind="iconMd" aria-hidden="true" />
      </Button>

      <form class="landing-hero__join" @submit.prevent="emit('join')">
        <!-- A search field, so iCloud Passwords does not offer logins here. -->
        <input
          v-model="roomCode"
          class="landing-hero__join-input"
          type="search"
          name="room-search"
          placeholder="Код комнаты"
          aria-label="Код комнаты"
          maxlength="120"
          autocapitalize="off"
          autocomplete="off"
          spellcheck="false"
          data-1p-ignore
          data-lpignore="true"
          data-bwignore
          @keydown="onRoomCodeKeydown"
        />
        <button class="landing-hero__join-btn" type="submit" :disabled="joining">Войти</button>
      </form>
    </div>

    <p class="landing-hero__disclaimer">Без имени и регистрации · комната живёт, пока в ней есть люди</p>

    <LandingFeatureGrid :items="START_FEATURES" />
  </section>
</template>
