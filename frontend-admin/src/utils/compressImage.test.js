import { describe, it, expect, afterEach, vi } from 'vitest';
import { compressImage } from './compressImage.js';

const realCreateElement = document.createElement.bind(document);

function stubCanvas(blob = new Blob(['compressed'], { type: 'image/jpeg' })) {
  const ctx = { fillStyle: '', fillRect: vi.fn(), drawImage: vi.fn() };
  const canvas = {
    width: 0,
    height: 0,
    getContext: vi.fn(() => ctx),
    toBlob: vi.fn((cb) => cb(blob)),
  };
  vi.spyOn(document, 'createElement').mockImplementation((tag, ...rest) =>
    tag === 'canvas' ? canvas : realCreateElement(tag, ...rest)
  );
  return { canvas, ctx };
}

const makeFile = (size, name = 'photo.jpg', type = 'image/jpeg') =>
  new File([new Uint8Array(size)], name, { type });

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('compressImage', () => {
  it('downscales a large photo to the max dimension and re-encodes as JPEG', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 4000, height: 3000, close: vi.fn() })));
    const { canvas, ctx } = stubCanvas();

    const file = makeFile(200 * 1024);
    const out = await compressImage(file);

    expect(canvas.width).toBe(1600);
    expect(canvas.height).toBe(1200);
    expect(ctx.drawImage).toHaveBeenCalled();
    expect(out).not.toBe(file);
    expect(out.type).toBe('image/jpeg');
    expect(out.name).toBe('photo.jpg');
  });

  it('leaves an already-small image untouched', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 800, height: 600, close: vi.fn() })));
    const file = makeFile(300 * 1024);
    expect(await compressImage(file)).toBe(file);
  });

  it('falls back to the original if the image cannot be decoded', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn(async () => { throw new Error('nope'); }));
    vi.stubGlobal('Image', class {
      set src(_v) { queueMicrotask(() => this.onerror && this.onerror(new Error('bad'))); }
    });
    vi.stubGlobal('URL', { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} });

    const file = makeFile(200 * 1024);
    expect(await compressImage(file)).toBe(file);
  });

  it('ignores non-image files', async () => {
    const file = new File(['hello'], 'notes.txt', { type: 'text/plain' });
    expect(await compressImage(file)).toBe(file);
  });
});
