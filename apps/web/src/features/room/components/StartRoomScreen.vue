<script setup lang="ts">
import { Button, Field, TextField } from '@voiceroom/ui-kit/components';
import { t } from '@/shared/i18n';
import { createRoomFromStart, handleRoomCodeKeydown, joinRoomByCode } from '@voiceroom/call/engine/room/room-start';
import { saveStartName, updateNameStatuses } from '@voiceroom/call/engine/ui/names';
import { useStartUiStore } from '@voiceroom/call/engine/core/start-ui.store';
import FeatureList from '@/shared/components/FeatureList.vue';
import { START_FEATURES } from '@/shared/start-features';
import { useCallPageStore } from '@voiceroom/call/engine/core/call-page.store';

const startUi = useStartUiStore();
const page = useCallPageStore();

function handleCreateClick(): void {
  void createRoomFromStart();
}
</script>

<template>
  <main
    id="startScreen"
    class="start-layout start-room"
    :aria-label="t('Стартовый экран')"
    :hidden="page.screen !== 'start'"
  >
    <section class="start-layout__copy" aria-labelledby="startTitle">
      <p class="eyebrow">voice room</p>
      <h1 id="startTitle" class="start-room__title">{{ t('Голосовая комната без лишних дверей') }}</h1>
      <p class="start-room__lead">
        {{ t('Сначала сохраните имя, потом создайте комнату или зайдите к своим по коду.') }}
      </p>

      <FeatureList :items="START_FEATURES" />
    </section>

    <section class="start-room__panel" :aria-label="t('Создать или найти комнату')">
      <form id="startForm" class="start-room__form" @submit="saveStartName">
        <Field id="startNameInput" :label="t('Ваше имя')">
          <TextField
            v-model="startUi.nameInput"
            size="lg"
            maxlength="40"
            autocomplete="name"
            :placeholder="t('Ваше имя')"
            required
            @update:model-value="updateNameStatuses"
          />
        </Field>

        <Button variant="outline" size="lg" type="submit">{{ t('Сохранить имя') }}</Button>
        <p
          id="startNameStatus"
          :class="['start-room__status', { 'start-room__status--dirty': startUi.savedNameState === 'dirty' }]"
        >
          {{ startUi.savedNameStatus }}
        </p>
      </form>

      <div class="start-room__divider">
        <span>{{ t('комната') }}</span>
      </div>

      <div class="start-room__actions">
        <Button
          id="createRoomButton"
          variant="primary"
          size="xl"
          type="button"
          :busy="startUi.createRoomLoading"
          @click="handleCreateClick"
        >
          {{ startUi.createRoomLoading ? t('Создаём...') : t('Создать комнату') }}
        </Button>

        <Field id="roomCodeInput" :label="t('Код комнаты')">
          <TextField
            v-model="startUi.roomCode"
            size="lg"
            maxlength="120"
            autocapitalize="off"
            autocomplete="off"
            spellcheck="false"
            placeholder="x7m2kq9p"
            @keydown="handleRoomCodeKeydown"
          />
        </Field>

        <Button id="joinByCodeButton" variant="outline" size="lg" type="button" @click="joinRoomByCode">
          {{ t('Войти по коду') }}
        </Button>
      </div>
    </section>
  </main>
</template>
