import { createApp } from 'vue';
import { createPinia } from 'pinia';
import type { Staff } from '../../src/staff.store.ts';
import Fixture from './Fixture.vue';
import '../../src/styles/main.scss';

const staff: Staff = {
  user: {
    id: 'fixture',
    login: 'fixture',
    displayName: 'Fixture',
    avatarUrl: null,
    avatarColorKey: 'blue',
    avatarAccent: null
  },
  role: 'admin',
  permissions: ['accounts.view'],
  siteUrl: 'http://127.0.0.1:15180'
};

createApp(Fixture, { staff }).use(createPinia()).mount('#root');
