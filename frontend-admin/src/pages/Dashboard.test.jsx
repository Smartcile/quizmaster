import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../services/api', () => ({ api: { get: vi.fn(), post: vi.fn(), delete: vi.fn() } }));

import { api } from '../services/api';
import Dashboard from './Dashboard.jsx';

const stats = { questions: 10, rounds: 3, quizzes: 2, activeSessions: 0, byDifficulty: [], byCategory: [] };
const quizzes = [
  { id: 1, name: 'Quiz A', code: 'AAA111' },
  { id: 2, name: 'Quiz B', code: 'BBB222' },
];

function mockApi({ activeFor = {}, tests = [] } = {}) {
  api.get.mockImplementation((path) => {
    if (path === '/questions/stats') return Promise.resolve(stats);
    if (path === '/quizzes') return Promise.resolve(quizzes);
    if (path === '/quizzes/sessions/test') return Promise.resolve(tests);
    const m = path.match(/^\/quizzes\/(\d+)\/active-session$/);
    if (m) return activeFor[m[1]] ? Promise.resolve(activeFor[m[1]]) : Promise.reject(new Error('no active session'));
    const qm = path.match(/^\/quizzes\/(\d+)$/);
    if (qm) return Promise.resolve(quizzes.find(q => q.id === Number(qm[1])));
    return Promise.resolve([]);
  });
}

beforeEach(() => {
  mockApi();
  api.post.mockReset();
  api.delete.mockReset().mockResolvedValue({ ok: true });
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});
afterEach(cleanup);

describe('Dashboard', () => {
  it('shows the stats and the quiz list', async () => {
    render(<Dashboard />);
    expect(await screen.findByText('Quiz A')).toBeInTheDocument();
    expect(screen.getByText('Questions')).toBeInTheDocument();
    expect(screen.getByText('10')).toBeInTheDocument();
  });

  it('starts a session and hands it to the app', async () => {
    api.post.mockResolvedValue({ id: 42 });
    const onQuizStart = vi.fn();
    const user = userEvent.setup();
    render(<Dashboard onQuizStart={onQuizStart} />);
    await screen.findByText('Quiz A');
    await user.click(screen.getAllByRole('button', { name: /Start Session/i })[0]);
    expect(api.post).toHaveBeenCalledWith('/quizzes/1/start', { isTest: false, force: false });
    expect(onQuizStart).toHaveBeenCalledWith(42, expect.objectContaining({ id: 1 }), false);
  });

  it('confirms and forces a restart when a session is already running (409)', async () => {
    api.post
      .mockRejectedValueOnce(new Error('409: A session is already running for this quiz.'))
      .mockResolvedValueOnce({ id: 77 });
    const onQuizStart = vi.fn();
    const user = userEvent.setup();
    render(<Dashboard onQuizStart={onQuizStart} />);
    await screen.findByText('Quiz A');
    await user.click(screen.getAllByRole('button', { name: /Start Session/i })[0]);
    expect(window.confirm).toHaveBeenCalled();
    expect(api.post).toHaveBeenLastCalledWith('/quizzes/1/start', { isTest: false, force: true });
    expect(onQuizStart).toHaveBeenCalledWith(77, expect.anything(), false);
  });

  it('shows a live card with Resume Control for an active session', async () => {
    mockApi({ activeFor: { 1: { id: 5, status: 'active', current_slide_index: 0 } } });
    const onQuizStart = vi.fn();
    render(<Dashboard onQuizStart={onQuizStart} activeQuizId={5} />);
    expect(await screen.findByText('● LIVE NOW')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Currently Controlling/i })).toBeInTheDocument();
  });

  it('lists and deletes test sessions', async () => {
    mockApi({ tests: [{ id: 9, quiz_id: 1, quiz_name: 'Test A', status: 'lobby', code: null, current_slide_index: 0 }] });
    const user = userEvent.setup();
    render(<Dashboard />);
    expect(await screen.findByText('Test A')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^Delete$/i }));
    expect(api.delete).toHaveBeenCalledWith('/quizzes/sessions/9');
    expect(screen.queryByText('Test A')).not.toBeInTheDocument();
  });
});
