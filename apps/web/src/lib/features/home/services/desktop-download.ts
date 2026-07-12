export function triggerDesktopDownload(url: string): void {
  const link = document.createElement('a');
  link.href = url;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
}

export async function copyText(text: string): Promise<void> {
  if (!navigator.clipboard?.writeText) {
    throw new Error('Clipboard API is unavailable');
  }
  await navigator.clipboard.writeText(text);
}
