// jsdom has no canvas and never loads images. These stand-ins let a component
// that draws a picked image onto a canvas and exports it run end to end: an
// image "loads" as soon as it gets a src, and a canvas exports a small webp
// blob. Undone with vi.unstubAllGlobals / vi.restoreAllMocks.

import { vi } from 'vitest';

export type CanvasExport = { width: number; height: number; type: string };

export function stubCanvasAndImages(options: { imageSize?: [number, number]; failExport?: boolean } = {}) {
  const [naturalWidth, naturalHeight] = options.imageSize ?? [800, 600];
  const exports: CanvasExport[] = [];

  class LoadedImage {
    naturalWidth = naturalWidth;
    naturalHeight = naturalHeight;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    #src = '';
    get src(): string {
      return this.#src;
    }
    set src(value: string) {
      this.#src = value;
      queueMicrotask(() => this.onload?.());
    }
  }
  vi.stubGlobal('Image', LoadedImage);

  const context = {
    clearRect: vi.fn(),
    drawImage: vi.fn(),
    getImageData: (_x: number, _y: number, width: number, height: number) => ({
      data: new Uint8ClampedArray(width * height * 4).fill(128)
    })
  };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    () => context as unknown as CanvasRenderingContext2D
  );
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/webp;base64,AA==');
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (
    this: HTMLCanvasElement,
    callback: BlobCallback,
    type?: string
  ) {
    exports.push({ width: this.width, height: this.height, type: type ?? '' });
    callback(options.failExport ? null : new Blob(['avatar'], { type: type ?? 'image/png' }));
  });

  return { context, exports };
}
