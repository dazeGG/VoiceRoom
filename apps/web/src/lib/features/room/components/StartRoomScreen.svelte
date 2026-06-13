<script lang="ts">
  import FeatureList from '$lib/shared/components/FeatureList.svelte';
  import { START_FEATURES } from '$lib/features/shared-content/start-features';
</script>

<main class="start-layout" id="startScreen" aria-label="Стартовый экран">
  <section class="start-copy" aria-labelledby="startTitle">
    <p class="eyebrow">voice room</p>
    <h1 class="hero-title" id="startTitle">Голосовая комната без лишних дверей</h1>
    <p class="hero-lead">Сначала сохраните имя, потом создайте комнату или зайдите к своим по коду.</p>

    <FeatureList items={START_FEATURES} />
  </section>

  <section class="start-panel" aria-label="Создать или найти комнату">
    <form class="name-panel" id="startForm">
      <label class="field">
        <span>Ваше имя</span>
        <input id="startNameInput" maxlength="40" autocomplete="name" placeholder="Например, Даша" required>
      </label>

      <button class="secondary-button" type="submit">Сохранить имя</button>
      <p class="name-status" id="startNameStatus">Имя не сохранено</p>
    </form>

    <div class="start-divider">
      <span>комната</span>
    </div>

    <div class="room-actions">
      <button class="primary-button" id="createRoomButton" type="button">Создать комнату</button>

      <label class="field">
        <span>Код комнаты</span>
        <input id="roomCodeInput" maxlength="120" autocapitalize="off" autocomplete="off" spellcheck="false" placeholder="x7m2kq9p">
      </label>

      <button class="secondary-button" id="joinByCodeButton" type="button">Войти по коду</button>
    </div>
  </section>
</main>
