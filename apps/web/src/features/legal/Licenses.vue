<script setup lang="ts">
// Third-party works the service ships or runs, with the attribution their
// licences require (Twemoji and DB-IP under CC BY 4.0 above all).
import { t } from '@/shared/i18n';
const LIBRARIES: { name: string; license: string }[] = [
  {
    get name() {
      return t('LiveKit (сервер и клиент)');
    },
    license: 'Apache 2.0'
  },
  { name: 'Vue, Vue Router, Pinia', license: 'MIT' },
  { name: 'Reka UI', license: 'MIT' },
  { name: 'Lucide', license: 'ISC' },
  { name: 'Fastify', license: 'MIT' },
  { name: 'PostgreSQL', license: 'PostgreSQL License' },
  { name: 'Kysely, node-postgres', license: 'MIT' },
  { name: 'sharp', license: 'Apache 2.0' },
  { name: 'web-push', license: 'MPL 2.0' }
];
</script>

<template>
  <p>
    {{
      t(
        'VoiceRoom построен на открытых проектах. Ниже — работы, лицензии которых требуют указать автора, и основные библиотеки. Полные тексты лицензий всех зависимостей поставляются вместе с соответствующими пакетами.'
      )
    }}
  </p>

  <h2>{{ t('Работы с обязательной атрибуцией') }}</h2>
  <ul>
    <li>
      <strong><a href="https://github.com/discord/twemoji" rel="noopener" target="_blank">Twemoji</a></strong>
      {{
        t(
          '— графика эмодзи © Twitter, Inc. и другие участники проекта, сборка Discord. Используется без изменений. Лицензия:'
        )
      }}
      <a href="https://creativecommons.org/licenses/by/4.0/" rel="noopener" target="_blank">CC BY 4.0</a>.
    </li>
    <li>
      <strong><a href="https://db-ip.com" rel="noopener" target="_blank">DB-IP City Lite</a></strong>
      {{ t('— IP Geolocation by DB-IP: город и страна в списке устройств аккаунта. Лицензия:') }}
      <a href="https://creativecommons.org/licenses/by/4.0/" rel="noopener" target="_blank">CC BY 4.0</a>.
    </li>
    <li>
      <strong><a href="https://fontawesome.com" rel="noopener" target="_blank">Font Awesome Free</a></strong>
      {{ t('— значки платформ на странице загрузки приложения © Fonticons, Inc. Лицензия:') }}
      <a href="https://fontawesome.com/license/free" rel="noopener" target="_blank">CC BY 4.0</a>.
    </li>
    <li>
      <strong><a href="https://fonts.google.com/specimen/Onest" rel="noopener" target="_blank">Onest</a></strong>
      {{ t('— основной шрифт интерфейса © авторы Onest. Лицензия:') }}
      <a href="https://openfontlicense.org" rel="noopener" target="_blank">SIL Open Font License 1.1</a>.
    </li>
    <li>
      <strong
        ><a href="https://github.com/JetBrains/JetBrainsMono" rel="noopener" target="_blank">JetBrains Mono</a></strong
      >
      {{ t('— моноширинный шрифт © JetBrains s.r.o. Лицензия:') }}
      <a href="https://openfontlicense.org" rel="noopener" target="_blank">SIL Open Font License 1.1</a>.
    </li>
    <li>
      <strong><a href="https://www.unicode.org" rel="noopener" target="_blank">Unicode emoji data</a></strong>
      {{ t('— список эмодзи © Unicode, Inc. Условия:') }}
      <a href="https://www.unicode.org/terms_of_use.html" rel="noopener" target="_blank">Unicode Terms of Use</a>.
    </li>
    <li>
      <strong><a href="https://github.com/libvips/libvips" rel="noopener" target="_blank">libvips</a></strong>
      {{
        t(
          '— обработка изображений на сервере (через sharp). Исходный код libvips доступен по ссылке, текст лицензии поставляется вместе с программой. Лицензия:'
        )
      }}
      <a href="https://www.gnu.org/licenses/lgpl-3.0.html" rel="noopener" target="_blank">LGPL-3.0-or-later</a>.
    </li>
    <li>
      <strong
        ><a href="https://github.com/GoogleChrome/web-vitals" rel="noopener" target="_blank">web-vitals</a></strong
      >
      {{ t('— замер скорости страниц © Google LLC. Лицензия:') }}
      <a href="https://github.com/GoogleChrome/web-vitals/blob/main/LICENSE" rel="noopener" target="_blank"
        >Apache-2.0</a
      >.
    </li>
    <li>
      <strong><a href="https://github.com/xiph/rnnoise" rel="noopener" target="_blank">RNNoise</a></strong>
      {{
        t(
          '— шумоподавление микрофона © Xiph.Org Foundation и Mozilla; сборка для браузера © WONG Tin Chi Timothy, Dmitry Zlygin. Лицензии:'
        )
      }}
      <a href="https://github.com/xiph/rnnoise/blob/main/COPYING" rel="noopener" target="_blank">BSD-3-Clause</a>
      {{ t('и MIT.') }}
    </li>
  </ul>

  <h2>{{ t('Основные библиотеки') }}</h2>
  <ul>
    <li v-for="library in LIBRARIES" :key="library.name">{{ library.name }} — {{ library.license }}</li>
  </ul>
</template>
