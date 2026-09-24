import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../services/api', () => ({ api: { get: vi.fn(), post: vi.fn() } }));

import { api } from '../services/api';
import Settings from './Settings.jsx';

beforeEach(() => {
  api.get.mockReset().mockResolvedValue([]);          // /repos + /masters etc.
  api.post.mockReset().mockResolvedValue({ deleted: { questions: 30 } });
  localStorage.clear();
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});
afterEach(cleanup);

describe('Settings — Danger Zone', () => {
  it('requires a target and a typed DELETE before it will run', async () => {
    const user = userEvent.setup();
    render(<Settings />);
    await user.click(screen.getByRole('button', { name: /Danger Zone/i }));

    const del = screen.getByRole('button', { name: /Delete selected data/i });
    expect(del).toBeDisabled();

    await user.click(screen.getByLabelText(/All questions/i));
    // Wiping questions clears session results too
    expect(screen.getByText(/also clears all session results/i)).toBeInTheDocument();
    expect(del).toBeDisabled(); // still needs the typed confirm

    await user.type(screen.getByPlaceholderText(/Type DELETE/i), 'DELETE');
    expect(del).toBeEnabled();
  });

  it('posts the selected targets and shows the deleted summary', async () => {
    const user = userEvent.setup();
    render(<Settings />);
    await user.click(screen.getByRole('button', { name: /Danger Zone/i }));
    await user.click(screen.getByLabelText(/All questions/i));
    await user.type(screen.getByPlaceholderText(/Type DELETE/i), 'delete');
    await user.click(screen.getByRole('button', { name: /Delete selected data/i }));

    expect(api.post).toHaveBeenCalledWith('/admin/reset', expect.objectContaining({ questions: true }));
    expect(await screen.findByText(/Deleted: 30 questions/i)).toBeInTheDocument();
  });
});
