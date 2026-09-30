// Dropping images onto a chat: the surface counts nested drag enters so the
// overlay stays up while the pointer crosses child elements, and a drop hands
// the images to the conversation's compose store.

import {
  dataTransferHasImages,
  imageFilesFromDataTransfer,
  type AttachmentComposeStore
} from './attachment-compose.svelte';

export class AttachmentDrop {
  /** Nested drag enters over the surface; above zero the overlay shows. */
  depth = $state(0);

  #media: () => AttachmentComposeStore | null;
  #busy: () => boolean;
  #onError: (message: string) => void;

  constructor(options: {
    media: () => AttachmentComposeStore | null;
    /** While a message is being sent the surface takes no drops. */
    busy: () => boolean;
    onError: (message: string) => void;
  }) {
    this.#media = options.media;
    this.#busy = options.busy;
    this.#onError = options.onError;
  }

  get active(): boolean {
    return this.depth > 0;
  }

  #accepts(event: DragEvent): boolean {
    return Boolean(this.#media()) && !this.#busy() && dataTransferHasImages(event.dataTransfer);
  }

  enter = (event: DragEvent): void => {
    if (!this.#accepts(event)) return;
    event.preventDefault();
    this.depth += 1;
  };

  over = (event: DragEvent): void => {
    if (!this.#accepts(event)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
  };

  leave = (event: DragEvent): void => {
    if (!this.depth) return;
    event.preventDefault();
    this.depth = Math.max(0, this.depth - 1);
  };

  drop = async (event: DragEvent): Promise<void> => {
    const media = this.#media();
    if (!media) return;
    const files = imageFilesFromDataTransfer(event.dataTransfer);
    if (!files.length) return;
    event.preventDefault();
    this.depth = 0;
    try {
      await media.addFiles(files);
    } catch (cause) {
      this.#onError(cause instanceof Error ? cause.message : 'Не удалось загрузить изображение');
    }
  };
}
