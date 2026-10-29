import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, within, waitFor } from '@testing-library/react';

import ImageCropEditor, { resizeRect, clueAnswerName } from './ImageCropEditor.jsx';

const file = {
  url: '/u/bread.jpg',
  mime_type: 'image/jpeg',
  original_name: 'Bread.jpg',
  filename: 'bread.jpg'
};

class MockImage {
  constructor() { this.naturalWidth = 1200; this.naturalHeight = 800; }
  set src(_value) { queueMicrotask(() => this.onload?.()); }
}

beforeEach(() => vi.stubGlobal('Image', MockImage));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('ImageCropEditor', () => {
  it('shows the picture-round cell preview when preview is requested', async () => {
    render(<ImageCropEditor file={file} preview={{ columns: 5, number: 3 }} onClose={vi.fn()} />);
    const cell = await screen.findByTestId('crop-slide-preview');
    expect(cell).toBeInTheDocument();
    expect(within(cell).getByText('3')).toBeInTheDocument();
    expect(screen.getByText(/picture-round cell/i)).toBeInTheDocument();
  });

  it('renders no preview unless asked (Media Library crop)', async () => {
    render(<ImageCropEditor file={file} onClose={vi.fn()} />);
    expect(await screen.findByText(/Crop \/ resize/i)).toBeInTheDocument();
    expect(screen.queryByTestId('crop-slide-preview')).not.toBeInTheDocument();
  });

  it('offers a handle on every corner', async () => {
    const { container } = render(<ImageCropEditor file={file} onClose={vi.fn()} />);
    await waitFor(() => expect(container.querySelector('.ic-crop')).toBeInTheDocument());
    for (const pos of ['nw', 'ne', 'sw', 'se']) {
      expect(container.querySelector(`.ic-handle-${pos}`)).toBeInTheDocument();
    }
  });
});

describe('resizeRect', () => {
  const bounds = { w: 560, h: 420 };
  const orig = { x: 100, y: 100, w: 200, h: 200 };

  it('shrinks to the minimum from any corner and pins the opposite corner', () => {
    expect(resizeRect(orig, 'nw', 250, 250, { bounds }))
      .toEqual({ x: 292, y: 292, w: 8, h: 8 });
    expect(resizeRect(orig, 'se', -250, -250, { bounds }))
      .toEqual({ x: 100, y: 100, w: 8, h: 8 });
  });

  it('preserves the aspect ratio when one is set', () => {
    expect(resizeRect({ x: 0, y: 0, w: 200, h: 200 }, 'se', -100, 0, { bounds, aspect: 1 }))
      .toEqual({ x: 0, y: 0, w: 100, h: 100 });
  });

  it('never grows outside the image', () => {
    expect(resizeRect(orig, 'se', 1000, 1000, { bounds }))
      .toEqual({ x: 100, y: 100, w: 460, h: 320 });
  });
});

describe('clueAnswerName', () => {
  it('drops the extension, upload prefix and clue suffix', () => {
    expect(clueAnswerName({ original_name: 'Baguette.jpg' })).toBe('Baguette');
    expect(clueAnswerName({ original_name: '1785377179707-Starting Points.png' })).toBe('Starting Points');
    expect(clueAnswerName({ original_name: 'Baguette-clue.jpg' })).toBe('Baguette');
    expect(clueAnswerName({ display_name: 'Great Tit', filename: '1731-x.jpg' })).toBe('Great Tit');
  });
});
