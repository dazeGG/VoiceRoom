<script setup lang="ts">
import { Field, Spinner, TextField } from '@voice-room/ui/components';
import { t } from '@/shared/i18n';
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
    <p class="landing-hero__kicker">
      <span class="landing-hero__kicker-dot"></span>{{ t('Комната по ссылке за секунду') }}
    </p>
    <h1 id="landingTitle" class="landing-hero__title">{{ t('Голосовые комнаты для своих') }}</h1>
    <p class="landing-hero__lead">
      {{
        t('Нажмите — и вы уже в комнате. Код и ссылка появятся сразу. Аккаунт нужен, только чтобы сохранять комнаты.')
      }}
    </p>

    <div class="landing-hero__cta-row">
      <Button variant="primary" size="xl" :disabled="creatingTemp" @click="emit('createTemp')">
        <Spinner v-if="creatingTemp" aria-hidden="true" /> {{ t('Создать комнату') }}
        <ArrowRight v-bind="iconMd" aria-hidden="true" />
      </Button>

      <form class="landing-hero__join" @submit.prevent="emit('join')">
        <!-- A search field keeps iCloud Passwords from offering logins here. -->
        <Field class="landing-hero__join-field" :label="t('Код комнаты')">
          <TextField
            v-model="roomCode"
            type="search"
            variant="mono"
            name="room-search"
            :placeholder="t('Код комнаты')"
            maxlength="120"
            autocapitalize="off"
            autocomplete="off"
            spellcheck="false"
            data-1p-ignore
            data-lpignore="true"
            data-bwignore
            @keydown="onRoomCodeKeydown"
          />
        </Field>
        <Button variant="outline" type="submit" :disabled="joining">{{ t('Войти в комнату') }}</Button>
      </form>
    </div>

    <p class="landing-hero__disclaimer">{{ t('Без имени и регистрации · комната живёт, пока в ней есть люди') }}</p>

    <LandingFeatureGrid :items="START_FEATURES" />
  </section>
</template>
