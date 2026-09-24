import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../services/api', () => ({ api: { get: vi.fn() } }));

import { api } from '../services/api';
import MediaPicker from './MediaPicker.jsx';

const files = [
  { id: 1, url: '/u/cat.png', mime_type: 'image/png', original_name: 'Cat.png' },
  { id: 2, url: '/u/song.mp3', mime_type: 'audio/mpeg', original_name: 'Song.mp3' },
];

beforeEach(() => api.get.mockReset().mockResolvedValue(files));
afterEach(cleanup);

describe('MediaPicker', () => {
  it('lists library files and picks one', async () => {
    const onPick = vi.fn();
    const user = userEvent.setup();
    render(<MediaPicker onPick={onPick} onClose={vi.fn()} />);
    expect(await screen.findByTitle('Cat.png')).toBeInTheDocument();
    expect(screen.getByTitle('Song.mp3')).toBeInTheDocument();
    await user.click(screen.getByTitle('Cat.png'));
    expect(onPick).toHaveBeenCalledWith(files[0]);
  });

  it('filters by the search box', async () => {
    render(<MediaPicker onPick={vi.fn()} onClose={vi.fn()} />);
    await screen.findByTitle('Cat.png');
    fireEvent.change(screen.getByPlaceholderText(/Search media/i), { target: { value: 'song' } });
    expect(screen.queryByTitle('Cat.png')).not.toBeInTheDocument();
    expect(screen.getByTitle('Song.mp3')).toBeInTheDocument();
  });
});
