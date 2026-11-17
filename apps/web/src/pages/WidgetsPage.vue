<script setup lang="ts">
import '@/styles/widget/_configurator.scss';
import { computed, reactive } from 'vue';
import { defaultWidgetConfig, parseWidgetConfig } from '@voice-room/shared/contracts/widget';
import { widgetSnippet } from '@/features/widget/snippet';
const config = reactive({ ...defaultWidgetConfig });
const result = computed(() => {
  try {
    return { code: widgetSnippet(parseWidgetConfig(config), window.location.origin), error: '' };
  } catch {
    return { code: '', error: 'Проверьте диапазоны настроек.' };
  }
});
const preview = computed(() => ({
  backgroundColor: config.background,
  color: config.text,
  borderRadius: `${config.radius}px`,
  width: `${config.width}px`,
  minHeight: '20rem'
}));
</script>

<template>
  <main class="widget-configurator">
    <h1>Виджет VoiceRoom</h1>
    <p>Настройте виджет и вставьте код на свой сайт. Аккаунт не требуется.</p>
    <form @submit.prevent>
      <label
        >Размещение
        <select v-model="config.mode">
          <option value="inline">Блок на странице</option>
          <option value="floating">Плавающая панель</option>
        </select></label
      >
      <label>Фон <input v-model="config.background" type="color" /></label>
      <label>Текст <input v-model="config.text" type="color" /></label>
      <label>Акцент <input v-model="config.accent" type="color" /></label>
      <label>Скругление <input v-model.number="config.radius" type="number" min="0" max="24" /></label>
      <label>Ширина <input v-model.number="config.width" type="number" min="280" max="960" /></label>
      <label>Высота <input v-model.number="config.height" type="number" min="320" max="900" /></label>
      <label
        >Положение
        <select v-model="config.corner">
          <option value="bottom-right">Справа внизу</option>
          <option value="bottom-left">Слева внизу</option>
          <option value="top-right">Справа вверху</option>
          <option value="top-left">Слева вверху</option>
        </select></label
      >
      <label>Отступ <input v-model.number="config.offset" type="number" min="0" max="48" /></label>
      <label><input v-model="config.chat" type="checkbox" /> Текстовый чат</label>
    </form>
    <p>
      Настройка чата применяется при создании комнаты. При входе в существующую комнату её правила сохраняются;
      выключенный здесь чат будет скрыт в этом виджете.
    </p>
    <section aria-label="Предпросмотр" :style="preview" class="widget-preview">
      <strong>VoiceRoom</strong>
      <p>Голос и видео для вашей компании</p>
      <span :style="{ color: config.accent }">Создать комнату · Войти по коду</span>
      <p v-if="config.chat">Текстовый чат</p>
      <small>Предпросмотр: камера и микрофон не включаются.</small>
    </section>
    <p v-if="result.error" role="alert">{{ result.error }}</p>
    <label>Код вставки<textarea :value="result.code" readonly rows="5" spellcheck="false" /></label>
    <p>
      Чтобы изменить оформление или функции, замените код на сайте. Для связи нужны HTTPS и разрешения на микрофон и
      камеру. Если сайт ограничивает CSP, разрешите загрузку скрипта и фрейма с адреса VoiceRoom.
    </p>
  </main>
</template>
