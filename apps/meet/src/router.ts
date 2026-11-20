import { createRouter, createWebHistory } from 'vue-router';
import GuestPage from '@/pages/GuestPage.vue';
import OwnerPage from '@/pages/OwnerPage.vue';

export function createMeetRouter() {
  return createRouter({
    history: createWebHistory(),
    routes: [
      { path: '/', component: OwnerPage },
      { path: '/room/:roomId', name: 'room', component: GuestPage, props: true },
      { path: '/:missing(.*)', component: GuestPage, props: { roomId: '' } }
    ]
  });
}
