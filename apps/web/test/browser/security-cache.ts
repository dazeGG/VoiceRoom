import { createApp } from 'vue';
import { createPinia } from 'pinia';
import Fixture from './SecurityCacheFixture.vue';
createApp(Fixture).use(createPinia()).mount('#app');
