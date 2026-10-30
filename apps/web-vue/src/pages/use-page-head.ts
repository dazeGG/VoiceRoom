// Svelte: <svelte:head> with a <title> and the theme-color meta. A page sets
// both while it is shown and puts the old title back when it goes.

import { onBeforeUnmount, onMounted } from 'vue';

export function usePageHead(title: string, themeColor = '#131416'): void {
  let previousTitle = document.title;
  const meta = document.createElement('meta');
  meta.name = 'theme-color';
  meta.content = themeColor;

  onMounted(() => {
    previousTitle = document.title;
    document.title = title;
    document.head.append(meta);
  });

  onBeforeUnmount(() => {
    meta.remove();
    document.title = previousTitle;
  });
}
