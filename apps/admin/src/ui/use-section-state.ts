import { ref } from 'vue';

export function useSectionState(page: string, id: string, defaultOpen = true) {
  const key = 'vr-admin-section-' + page + '-' + id;
  function read(): boolean {
    try {
      const saved = window.localStorage.getItem(key);
      return saved === null ? defaultOpen : saved === 'open';
    } catch {
      return defaultOpen;
    }
  }
  const open = ref(read());

  function setOpen(next: boolean): void {
    open.value = next;
    try {
      window.localStorage.setItem(key, next ? 'open' : 'closed');
    } catch {
      // A browser that keeps nothing still folds it for now.
    }
  }
  return { open, setOpen };
}
