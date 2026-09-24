import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// QuizControl imports the heavy Files modal + websocket hook — stub them.
vi.mock('../components/DownloadFilesModal.jsx', () => ({ default: () => null }));
vi.mock('../hooks/useWebSocket', () => ({ useWebSocket: () => null }));
vi.mock('../services/api', () => ({ api: { get: vi.fn(() => Promise.resolve([])), post: vi.fn() } }));

import { AddTeamForm } from './QuizControl.jsx';

beforeEach(() => { vi.clearAllMocks(); });
afterEach(cleanup);

describe('AddTeamForm', () => {
  it('is disabled until a name is entered, then submits name + size', async () => {
    const onAdd = vi.fn().mockResolvedValue();
    const user = userEvent.setup();
    render(<AddTeamForm onAdd={onAdd} />);

    const add = screen.getByRole('button', { name: /Add team/i });
    expect(add).toBeDisabled();

    await user.type(screen.getByPlaceholderText(/Add a team/i), 'The Kings');
    await user.clear(screen.getByRole('spinbutton'));
    await user.type(screen.getByRole('spinbutton'), '6');
    expect(add).toBeEnabled();

    await user.click(add);
    expect(onAdd).toHaveBeenCalledWith('The Kings', 6);
  });

  it('shows the error when adding fails', async () => {
    const onAdd = vi.fn().mockRejectedValue(new Error('Team already exists'));
    const user = userEvent.setup();
    render(<AddTeamForm onAdd={onAdd} />);
    await user.type(screen.getByPlaceholderText(/Add a team/i), 'Dup');
    await user.click(screen.getByRole('button', { name: /Add team/i }));
    expect(await screen.findByText('Team already exists')).toBeInTheDocument();
  });
});
