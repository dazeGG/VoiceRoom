import { createApp } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { installCallPorts } from '@voiceroom/call/engine/ports';
import type { VoiceAssetUrls } from '@voiceroom/call/voice-assets';
import { createMeetPorts } from '@/adapters/meet-ports';
import { installMeetI18n } from '@/i18n';
import { useMeetStore } from '@/meet.store';
import { createMeetRouter } from '@/router';
import App from '@/App.vue';
import '@/styles/main.scss';

declare const __VOICE_ASSET_URLS__: VoiceAssetUrls;

const pinia = createPinia();
setActivePinia(pinia);
installMeetI18n();
const meet = useMeetStore();
void meet.exchangeOwnerLink();
// The exchange removes the capability before router history snapshots the URL.
const router = createMeetRouter();
installCallPorts(
  createMeetPorts({
    identity: meet.identity,
    transport: meet.transport,
    assets: __VOICE_ASSET_URLS__,
    navigateToRoom: (roomId) => void router.push({ name: 'room', params: { roomId } }),
    goHome: () => void router.push('/')
  }),
  pinia
);
const app = createApp(App).use(pinia).use(router);
void router.isReady().then(() => app.mount('#app'));
