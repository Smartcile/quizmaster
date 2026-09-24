import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../services/api', () => ({ api: { get: vi.fn() } }));

import { api } from '../services/api';
import ImagePicker from './ImagePicker.jsx';

beforeEach(() => {
  api.get.mockReset().mockResolvedValue([
    { id: 1, text: 'Cat picture', media_url: '/u/cat.png' },
    { id: 2, text: 'No media here', media_url: '' },
  ]);
});
afterEach(cleanup);

describe('ImagePicker', () => {
  it('lists only questions that have media and picks one', async () => {
    const onPick = vi.fn();
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<ImagePicker onPick={onPick} onClose={onClose} />);
    expect(await screen.findByTitle('Cat picture')).toBeInTheDocument();
    expect(screen.queryByTitle('No media here')).not.toBeInTheDocument();
    await user.click(screen.getByTitle('Cat picture'));
    expect(onPick).toHaveBeenCalledWith('/u/cat.png');
    expect(onClose).toHaveBeenCalled();
  });

  it('filters by question text', async () => {
    render(<ImagePicker onPick={vi.fn()} onClose={vi.fn()} />);
    await screen.findByTitle('Cat picture');
    fireEvent.change(screen.getByPlaceholderText(/Filter by question text/i), { target: { value: 'zzz' } });
    expect(screen.queryByTitle('Cat picture')).not.toBeInTheDocument();
    expect(screen.getByText(/No results for that search/i)).toBeInTheDocument();
  });
});
