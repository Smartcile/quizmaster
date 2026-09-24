import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../services/api', () => ({ api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } }));

import { api } from '../services/api';
import RoundBuilder from './RoundBuilder.jsx';

beforeEach(() => {
  api.get.mockReset().mockImplementation((path) => {
    if (path === '/rounds') return Promise.resolve([]);
    if (path === '/questions') return Promise.resolve([]);
    if (path === '/questions/categories') return Promise.resolve(['Geography', 'History']);
    return Promise.resolve([]);
  });
  api.post.mockReset().mockResolvedValue({ id: 1 });
});
afterEach(cleanup);

async function openCreate() {
  const user = userEvent.setup();
  render(<RoundBuilder />);
  await user.click(await screen.findByRole('button', { name: /\+ Create Round/i }));
  return user;
}

describe('RoundBuilder — round style + category', () => {
  it('saves a textlist round with its mode, shared options and category', async () => {
    const user = await openCreate();

    await user.type(screen.getByPlaceholderText(/Round name/i), 'Geo List');
    // Style select currently shows "Standard round".
    await user.selectOptions(screen.getByText('Standard round').closest('select'), 'textlist');
    // Category (optional) input
    await user.type(screen.getByPlaceholderText(/Category \(optional\)/i), 'Geography');

    // The textlist config now appears — pick match mode and the shared options.
    await user.selectOptions(screen.getByText('Plain text answers').closest('select'), 'match');
    const optsBox = screen.getByPlaceholderText(/Small/i);
    fireEvent.change(optsBox, { target: { value: 'Small\nMedium\nLarge' } });

    await user.click(screen.getByRole('button', { name: 'Create Round' }));

    expect(api.post).toHaveBeenCalledWith('/rounds', expect.objectContaining({
      name: 'Geo List',
      style: 'textlist',
      category: 'Geography',
      list_mode: 'match',
      list_options: ['Small', 'Medium', 'Large'],
    }));
  });

  it('lists a saved textlist round with Text-list + category badges', async () => {
    api.get.mockImplementation((path) => {
      if (path === '/rounds') return Promise.resolve([
        { id: 1, name: 'Geo List', style: 'textlist', display_title: null, category: 'Geography', list_mode: 'match', list_options: ['S', 'M'], questions: [] },
      ]);
      if (path === '/questions') return Promise.resolve([]);
      if (path === '/questions/categories') return Promise.resolve(['Geography']);
      return Promise.resolve([]);
    });
    render(<RoundBuilder />);
    expect(await screen.findByText('Geo List')).toBeInTheDocument();
    expect(screen.getByText('📋 Text list')).toBeInTheDocument();
    expect(screen.getByText('Geography')).toBeInTheDocument();
  });
});
