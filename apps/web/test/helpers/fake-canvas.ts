// jsdom has no canvas and never loads images. These stand-ins let a component
// that draws a picked image onto a canvas and exports it run end to end: an
// image "loads" as soon as it gets a src, and a canvas exports a small webp
// blob. Undone with vi.unstubAllGlobals / vi.restoreAllMocks.

import { vi } from 'vitest';
import type * as Canvas2DModule from '@/shared/ui/AvatarCropDialog/canvas-2d';

function newContext(): Canvas2DModule.Canvas2D {
  return {
    clearRect: vi.fn(),
    drawImage: vi.fn(),
    getImageData: (_x, _y, width, height) => ({ data: new Uint8ClampedArray(width * height * 4).fill(128) })
  };
}

// Each stubCanvasAndImages call starts a fresh context, so call counts never leak between tests.
let fakeContext = newContext();

/**
 * Stands in for the crop dialog's canvas module. jsdom's own canvas has no 2D
 * context, so a test that renders the dialog must mock the module with it:
 * `vi.mock('…/AvatarCropDialog/canvas-2d.ts', () => fakeCanvas2d)`.
 */
export const fakeCanvas2d: typeof Canvas2DModule = { context2d: () => fakeContext };

export type CanvasExport = { width: number; height: number; type: string };

export function stubCanvasAndImages(options: { imageSize?: [number, number]; failExport?: boolean } = {}) {
  const [naturalWidth, naturalHeight] = options.imageSize ?? [800, 600];
  const exports: CanvasExport[] = [];
  fakeContext = newContext();

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

  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/webp;base64,AA==');
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (
    this: HTMLCanvasElement,
    callback: BlobCallback,
    type?: string
  ) {
    exports.push({ width: this.width, height: this.height, type: type ?? '' });
    callback(options.failExport ? null : new Blob(['avatar'], { type: type ?? 'image/png' }));
  });

  return { context: fakeContext, exports };
}
