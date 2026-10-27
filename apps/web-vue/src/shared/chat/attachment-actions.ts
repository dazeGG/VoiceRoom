// What the message menu can do with the picture it was opened on: copy it to
// the clipboard or save it as a file.

import type { Attachment } from '@voice-room/shared/contracts/messages';
import { attachmentVariantUrl } from '../../api/attachments';

/** The ready attachment a right-click landed on, or null when it landed elsewhere in the message. */
export function attachmentAt(
  target: EventTarget | null,
  attachments: readonly Attachment[] | undefined
): Attachment | null {
  if (!(target instanceof Element)) return null;
  const id = target.closest<HTMLElement>('[data-attachment-id]')?.dataset.attachmentId;
  return attachments?.find((attachment) => attachment.id === id && attachment.state === 'ready') ?? null;
}

export function downloadAttachment(attachment: Attachment): void {
  // Same origin, so `download` saves the file instead of navigating the page.
  const link = document.createElement('a');
  link.href = attachmentVariantUrl(attachment.id, 'processed', true);
  link.download = '';
  document.body.appendChild(link);
  link.click();
  link.remove();
}

// Browsers put only PNG images on the clipboard; anything else is redrawn as PNG.
async function asPng(blob: Blob): Promise<Blob> {
  if (blob.type === 'image/png') return blob;
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0);
  bitmap.close();
  return new Promise((resolve, reject) =>
    canvas.toBlob((png) => (png ? resolve(png) : reject(new Error('PNG encoding failed'))), 'image/png')
  );
}

export async function copyAttachmentImage(attachment: Attachment): Promise<void> {
  if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') {
    throw new Error('Clipboard API is unavailable');
  }
  // The item takes the pending image, so the write stays inside the click
  // that asked for it while the picture is still being fetched.
  const png = fetch(attachmentVariantUrl(attachment.id, 'processed')).then(async (response) => {
    if (!response.ok) throw new Error(`attachment fetch failed: ${response.status}`);
    return asPng(await response.blob());
  });
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
}
