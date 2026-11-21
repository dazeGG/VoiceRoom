import { onBeforeUnmount, onMounted, shallowRef } from 'vue';
import { locationFromPath, pathOf, type AdminLocation } from './tabs.ts';

export function useAdminLocation() {
  const read = () => locationFromPath(window.location.pathname);
  const location = shallowRef(read());
  const onPop = () => {
    location.value = read();
  };

  onMounted(() => window.addEventListener('popstate', onPop));
  onBeforeUnmount(() => window.removeEventListener('popstate', onPop));

  function go(next: AdminLocation, replace = false): void {
    const path = pathOf(next);
    if (window.location.pathname !== path) {
      if (replace) window.history.replaceState(null, '', path);
      else window.history.pushState(null, '', path);
    }
    location.value = next;
  }

  return { location, go };
}
