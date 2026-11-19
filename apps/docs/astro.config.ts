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
      components: {
        ThemeProvider: './src/components/FixedTheme.astro',
        ThemeSelect: './src/components/FixedTheme.astro'
      },
      sidebar: [
        { label: 'Главная', slug: '' },
        { label: 'Первый звонок', slug: 'start/first-call' },
        {
          label: 'Комнаты и общение',
          items: [
            { label: 'Комнаты и чат', slug: 'rooms/rooms-and-chat' },
            { label: 'Друзья и уведомления', slug: 'rooms/friends-and-notifications' }
          ]
        },
        {
          label: 'Звук, видео и экран',
          items: [
            { label: 'Микрофон, наушники и камера', slug: 'media/audio-video' },
            { label: 'Демонстрация экрана со звуком', slug: 'media/screen-sharing' }
          ]
        },
        { label: 'Приложение для компьютера', slug: 'desktop/install' },
        { label: 'Аккаунт и безопасность', slug: 'account/security' },
        {
          label: 'Решение проблем',
          items: [
            { label: 'Не работает звук', slug: 'troubleshooting/audio' },
            { label: 'Не получается войти в комнату', slug: 'troubleshooting/connection' },
            {
              label: 'Нет звука в демонстрации экрана',
              link: '/media/screen-sharing#если-зрители-не-слышат-звук'
            }
          ]
        },
        {
          label: 'Виджет для сайта',
          items: [
            { label: 'Установка виджета', slug: 'widgets/install' },
            { label: 'Размещение и оформление', slug: 'widgets/customize' },
            { label: 'Проблемы со встраиванием', slug: 'widgets/troubleshooting' }
          ]
        },
        { label: 'Сайт VoiceRoom', link: 'https://voiceroom.ru/' }
      ]
    })
  ]
});
