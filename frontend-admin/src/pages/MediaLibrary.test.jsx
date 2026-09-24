import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../components/ImageCropEditor.jsx', () => ({ default: () => null }));
vi.mock('../components/AudioEditor.jsx', () => ({ default: () => null }));
vi.mock('../components/VideoEditor.jsx', () => ({ default: () => null }));
vi.mock('../services/api', () => ({ api: { get: vi.fn(), put: vi.fn(), delete: vi.fn(), post: vi.fn() } }));

import { api } from '../services/api';
import MediaLibrary from './MediaLibrary.jsx';

const files = [
  { id: 1, filename: 'a.png', original_name: 'Cat.png', url: '/u/a.png', mime_type: 'image/png', size_bytes: 2048, folder: 'Pics', labels: ['Question'], in_use: true, uploaded_at: '2026-01-01T00:00:00Z' },
  { id: 2, filename: 'b.mp3', original_name: 'Song.mp3', url: '/u/b.mp3', mime_type: 'audio/mpeg', size_bytes: 5000, folder: null, labels: [], in_use: false, uploaded_at: '2026-01-01T00:00:00Z' },
];

beforeEach(() => {
  api.get.mockReset().mockImplementation((path) => {
    if (path === '/media') return Promise.resolve(files);
    if (path === '/media/1/usage') return Promise.resolve({ file: files[0], usage: { questions: [{ id: 7, text: 'Capital?' }], slide_masters: [] } });
    if (path === '/media/2/usage') return Promise.resolve({ file: files[1], usage: { questions: [], slide_masters: [] } });
    return Promise.resolve({});
  });
  api.put.mockReset().mockResolvedValue({ id: 2, display_name: 'New Name', folder: '' });
});
afterEach(cleanup);

describe('MediaLibrary', () => {
  it('renders cards with usage chips and folder meta', async () => {
    render(<MediaLibrary />);
    expect(await screen.findByTitle('Cat.png')).toBeInTheDocument();
    expect(screen.getByTitle('Song.mp3')).toBeInTheDocument();
    expect(screen.getByText('Question')).toBeInTheDocument();
    expect(screen.getByText(/📂 Pics/)).toBeInTheDocument();
  });

  it('filters by folder', async () => {
    const user = userEvent.setup();
    render(<MediaLibrary />);
    await screen.findByTitle('Cat.png');
    await user.selectOptions(screen.getByTitle('Filter by folder'), 'Pics');
    expect(screen.getByTitle('Cat.png')).toBeInTheDocument();
    expect(screen.queryByTitle('Song.mp3')).not.toBeInTheDocument();
  });

  it('opens a detail modal, shows usage and saves a new display name', async () => {
    const user = userEvent.setup();
    render(<MediaLibrary />);
    await user.click(await screen.findByTitle('Song.mp3'));
    // Unused file → safe to delete
    expect(await screen.findByText(/safe to delete/i)).toBeInTheDocument();

    const nameInput = screen.getByPlaceholderText('Friendly name');
    await user.clear(nameInput);
    await user.type(nameInput, 'New Name');
    await user.click(screen.getByRole('button', { name: /^Save$/i }));
    expect(api.put).toHaveBeenCalledWith('/media/2', expect.objectContaining({ display_name: 'New Name', folder: '' }));
  });

  it('disables Delete for a file that is still in use', async () => {
    const user = userEvent.setup();
    render(<MediaLibrary />);
    await user.click(await screen.findByTitle('Cat.png'));
    expect(await screen.findByText('Capital?')).toBeInTheDocument();
    const modal = document.querySelector('.media-detail-modal');
    expect(within(modal).getByRole('button', { name: /Delete/i })).toBeDisabled();
  });
});
