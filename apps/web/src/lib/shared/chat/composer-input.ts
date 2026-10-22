// What the room composer and the direct-message composer do with a key press
// and a paste in the same way.

import { imageFilesFromClipboard, type AttachmentComposeStore } from './attachment-compose.svelte';

/** Enter sends (Shift+Enter breaks the line); ArrowUp in an empty field edits the last own message, like Discord. */
export function sendOrEditLast(
  event: KeyboardEvent,
  composer: { empty: boolean; send: () => void; editLast: () => boolean }
): void {
  if (event.isComposing) return;
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    composer.send();
    return;
  }
  if (event.key === 'ArrowUp' && composer.empty && composer.editLast()) event.preventDefault();
}

/** Pasted images join the message's attachments; anything else pastes as text. */
export async function pasteImages(
  media: AttachmentComposeStore | null,
  event: ClipboardEvent,
  onError: (message: string) => void
): Promise<void> {
  if (!media) return;
  const files = imageFilesFromClipboard(event);
  if (!files.length) return;
  event.preventDefault();
  try {
    await media.addFiles(files);
  } catch (cause) {
    onError(cause instanceof Error ? cause.message : 'Не удалось вставить изображение');
  }
}
