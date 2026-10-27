<script setup lang="ts">
import { createRoomFromStart, handleRoomCodeKeydown, joinRoomByCode } from '@/features/room/client/room/room-start';
import { saveStartName, updateNameStatuses } from '@/features/room/client/ui/names';
import { useStartUiStore } from '@/features/room/start-ui.store';
import FeatureList from '@/shared/components/FeatureList.vue';
import { START_FEATURES } from '@/shared/start-features';
import { usePageStore } from '@/stores/page.store';

const startUi = useStartUiStore();
const page = usePageStore();

function handleCreateClick(): void {
  void createRoomFromStart();
}
</script>

<template>
  <main id="startScreen" class="start-layout start-room" aria-label="Стартовый экран" :hidden="page.screen !== 'start'">
    <section class="start-layout__copy" aria-labelledby="startTitle">
      <p class="eyebrow">voice room</p>
      <h1 id="startTitle" class="start-room__title">Голосовая комната без лишних дверей</h1>
      <p class="start-room__lead">Сначала сохраните имя, потом создайте комнату или зайдите к своим по коду.</p>

      <FeatureList :items="START_FEATURES" />
    </section>

    <section class="start-room__panel" aria-label="Создать или найти комнату">
      <form id="startForm" class="start-room__form" @submit="saveStartName">
        <label class="start-room__field">
          <span>Ваше имя</span>
          <input
            id="startNameInput"
            v-model="startUi.nameInput"
            maxlength="40"
            autocomplete="name"
            placeholder="Ваше имя"
            required
            @input="updateNameStatuses(startUi.nameInput)"
          />
        </label>

        <button class="start-room__button start-room__button--secondary" type="submit">Сохранить имя</button>
        <p
          id="startNameStatus"
          :class="[
            'start-room__status',
            { 'start-room__status--saved': startUi.savedNameState === 'saved' },
            { 'start-room__status--dirty': startUi.savedNameState === 'dirty' }
          ]"
        >
          {{ startUi.savedNameStatus }}
        </p>
      </form>

      <div class="start-room__divider">
        <span>комната</span>
      </div>

      <div class="start-room__actions">
        <button
          id="createRoomButton"
          class="start-room__button start-room__button--primary"
          type="button"
          :disabled="startUi.createRoomLoading"
          @click="handleCreateClick"
        >
          {{ startUi.createRoomLoading ? 'Создаём...' : 'Создать комнату' }}
        </button>

        <label class="start-room__field">
          <span>Код комнаты</span>
          <input
            id="roomCodeInput"
            v-model="startUi.roomCode"
            maxlength="120"
            autocapitalize="off"
            autocomplete="off"
            spellcheck="false"
            placeholder="x7m2kq9p"
            @keydown="handleRoomCodeKeydown"
          />
        </label>

        <button
          id="joinByCodeButton"
          class="start-room__button start-room__button--secondary"
          type="button"
          @click="joinRoomByCode"
        >
          Войти по коду
        </button>
      </div>
    </section>
  </main>
</template>
