import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../services/api', () => ({ api: { get: vi.fn(), delete: vi.fn() } }));

import { api } from '../services/api';
import QuizHistory from './QuizHistory.jsx';

const history = [{ session_id: 1, quiz_name: 'Quiz A', quiz_code: 'AAA111', created_at: '2026-01-02T10:00:00Z', team_count: 2 }];
const results = { teams: [
  { id: 1, name: 'Alpha', size: 2, score_total: '5', brownie_total: '2', size_points: '4', whoami_points: '1' },
  { id: 2, name: 'Beta', size: 6, score_total: '3', brownie_total: '0', size_points: '0', whoami_points: '0' },
] };

beforeEach(() => {
  api.get.mockReset().mockImplementation((path) => {
    if (path === '/quizzes/sessions/history') return Promise.resolve(history);
    if (path === '/quizzes/sessions/1/results') return Promise.resolve(results);
    return Promise.resolve([]);
  });
  api.delete.mockReset().mockResolvedValue({ ok: true });
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  vi.spyOn(window, 'open').mockImplementation(() => {});
});
afterEach(cleanup);

describe('QuizHistory', () => {
  it('lists finished sessions and expands to a scored table', async () => {
    const user = userEvent.setup();
    render(<QuizHistory />);
    expect(await screen.findByText('Quiz A')).toBeInTheDocument();
    expect(screen.getByText('#AAA111')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Quiz A/ }));
    expect(await screen.findByText('Alpha')).toBeInTheDocument();
    // Winner medal + handicap (+4) + Who Am I? column + total (5+2+4+1 = 12)
    expect(screen.getByText('🥇')).toBeInTheDocument();
    expect(screen.getByText('+4')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Who Am I?' })).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
  });

  it('removes a session after a confirmed delete', async () => {
    const user = userEvent.setup();
    render(<QuizHistory />);
    await user.click(await screen.findByRole('button', { name: /Quiz A/ }));
    await user.click(await screen.findByRole('button', { name: /Delete/i }));
    expect(api.delete).toHaveBeenCalledWith('/quizzes/sessions/1');
    expect(screen.queryByText('Quiz A')).not.toBeInTheDocument();
  });

  it('shows an empty state when there is no history', async () => {
    api.get.mockResolvedValue([]);
    render(<QuizHistory />);
    expect(await screen.findByText(/No finished quiz sessions yet/i)).toBeInTheDocument();
  });
});
