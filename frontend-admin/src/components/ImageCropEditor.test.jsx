import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';

import ImageCropEditor from './ImageCropEditor.jsx';

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
});
