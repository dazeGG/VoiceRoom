// The part of a 2D canvas context the crop dialog draws and reads with. jsdom
// has no canvas, so component tests stand this module in with a fake that
// implements exactly these calls.

export type Canvas2D = Pick<CanvasRenderingContext2D, 'clearRect' | 'drawImage'> & {
  getImageData(sx: number, sy: number, sw: number, sh: number): { data: Uint8ClampedArray };
};

export function context2d(canvas: HTMLCanvasElement, settings?: CanvasRenderingContext2DSettings): Canvas2D | null {
  return canvas.getContext('2d', settings);
}
