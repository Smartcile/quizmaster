import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';

vi.mock('./hooks/useWebSocket', () => ({ useWebSocket: () => globalThis.__sock }));
vi.mock('./services/api', () => ({ api: { get: vi.fn(), post: vi.fn() } }));

import { api } from './services/api';
import App from './App.jsx';

function fakeSocket() {
  const handlers = {};
  return {
    connected: true, handlers,
    on: vi.fn((ev, fn) => { handlers[ev] = fn; }),
    off: vi.fn(),
    emit: vi.fn(),
    trigger(ev, d) { handlers[ev]?.(d); },
  };
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  window.history.replaceState({}, '', '/');
  globalThis.__sock = fakeSocket();
  api.get.mockReset().mockResolvedValue({});
  api.post.mockReset().mockResolvedValue({});
});
afterEach(cleanup);

const qz = (name = 'Quiz Night') => ({ name, code: 'ABC123', items: [] });

describe('App — join form', () => {
  it('starts on the join form when there is no stored identity', async () => {
    render(<App />);
    expect(await screen.findByRole('button', { name: /Join Quiz/i })).toBeInTheDocument();
  });

  it('joins via the form and enters the waiting lobby', async () => {
    api.get.mockImplementation((path) => {
      if (path === '/quizzes/resolve/ABC123') return Promise.resolve({ quiz: qz(), session: { id: 5, status: 'lobby' } });
      return Promise.resolve({});
    });
    api.post.mockResolvedValue({ id: 1, name: 'Alpha' });
    render(<App />);

    fireEvent.change(await screen.findByPlaceholderText('ABC123'), { target: { value: 'abc123' } });
    fireEvent.change(screen.getByPlaceholderText(/Quizinators/i), { target: { value: 'Alpha' } });
    fireEvent.click(screen.getByRole('button', { name: /Join Quiz/i }));

    expect(await screen.findByText('Alpha')).toBeInTheDocument();
    expect(screen.getByText(/Waiting for the quiz master/i)).toBeInTheDocument();
    expect(api.post).toHaveBeenCalledWith('/teams/join', expect.objectContaining({ sessionId: 5, name: 'Alpha' }));
  });

  it('shows an error for an unknown code', async () => {
    api.get.mockResolvedValue({ quiz: null, session: null });
    render(<App />);
    fireEvent.change(await screen.findByPlaceholderText('ABC123'), { target: { value: 'ZZZZZZ' } });
    fireEvent.change(screen.getByPlaceholderText(/Quizinators/i), { target: { value: 'Alpha' } });
    fireEvent.click(screen.getByRole('button', { name: /Join Quiz/i }));
    expect(await screen.findByText(/not found/i)).toBeInTheDocument();
  });
});

describe('App — identity restore', () => {
  it('restores a stored team into its live session', async () => {
    localStorage.setItem('quizTeam', JSON.stringify({ teamId: 1, code: 'ABC123' }));
    api.get.mockImplementation((path) => {
      if (path === '/teams/1') return Promise.resolve({ id: 1, name: 'Alpha', quiz_session_id: 5 });
      if (path === '/quizzes/resolve/ABC123') return Promise.resolve({ quiz: qz(), session: { id: 5, status: 'lobby' } });
      return Promise.resolve({});
    });
    render(<App />);
    expect(await screen.findByText('Alpha')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Join Quiz/i })).not.toBeInTheDocument();
  });

  it('drops a stale stored team (quiz restarted → new session) and shows the join form', async () => {
    localStorage.setItem('quizTeam', JSON.stringify({ teamId: 1, code: 'ABC123' }));
    api.get.mockImplementation((path) => {
      if (path === '/teams/1') return Promise.resolve({ id: 1, name: 'Alpha', quiz_session_id: 9 }); // old session
      if (path === '/quizzes/resolve/ABC123') return Promise.resolve({ quiz: qz(), session: { id: 5, status: 'lobby' } });
      return Promise.resolve({});
    });
    render(<App />);
    expect(await screen.findByRole('button', { name: /Join Quiz/i })).toBeInTheDocument();
    await waitFor(() => expect(localStorage.getItem('quizTeam')).toBeNull());
  });
});

describe('App — live socket events', () => {
  async function enterAsTeam() {
    localStorage.setItem('quizTeam', JSON.stringify({ teamId: 1, code: 'ABC123' }));
    api.get.mockImplementation((path) => {
      if (path === '/teams/1') return Promise.resolve({ id: 1, name: 'Alpha', quiz_session_id: 5 });
      if (path === '/quizzes/resolve/ABC123') return Promise.resolve({ quiz: qz(), session: { id: 5, status: 'active' } });
      if (path.endsWith('/answers')) return Promise.resolve([]);
      if (path.endsWith('/scores')) return Promise.resolve({ scores: [] });
      return Promise.resolve({});
    });
    render(<App />);
    await screen.findByText('Alpha');
    return globalThis.__sock;
  }

  it('returns to the join form and explains when the host removes the team', async () => {
    const sock = await enterAsTeam();
    sock.trigger('team_removed', { teamId: 1 });
    expect(await screen.findByRole('button', { name: /Join Quiz/i })).toBeInTheDocument();
    expect(screen.getByText(/removed by the quiz master/i)).toBeInTheDocument();
  });

  it('reacts to a session_status_changed to finished by showing the review screen', async () => {
    const sock = await enterAsTeam();
    sock.trigger('session_status_changed', { status: 'finished' });
    expect(await screen.findByText(/final review/i)).toBeInTheDocument();
  });
});
