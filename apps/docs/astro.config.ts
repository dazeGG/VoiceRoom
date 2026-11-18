import starlight from '@astrojs/starlight';
import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://docs.voiceroom.ru',
  output: 'static',
  trailingSlash: 'never',
  build: {
    inlineStylesheets: 'never'
  },
  devToolbar: { enabled: false },
  integrations: [
    starlight({
      title: 'Документация VoiceRoom',
      description: 'Руководства по VoiceRoom для пользователей и владельцев сайтов',
      locales: { root: { label: 'Русский', lang: 'ru' } },
      favicon: '/voiceroom-icon.svg',
      logo: { src: './public/voiceroom-icon.svg', replacesTitle: false },
      customCss: ['./src/styles/voice-room.css'],
      sidebar: [
        { label: 'Главная', slug: '' },
        { label: 'Виджет для сайта', items: [{ label: 'Установка виджета', slug: 'widgets/install' }] },
        { label: 'Сайт VoiceRoom', link: 'https://voiceroom.ru/' }
      ]
    })
  ]
});
