import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

// Mock the api module before importing the component that uses it.
vi.mock('../services/api', () => ({ api: { get: vi.fn() } }));

import { api } from '../services/api';
import LiveScoreboard from './LiveScoreboard.jsx';

const payload = {
  teamSizeScoring: false, hasBrownie: false, hasWhoami: false,
  rounds: [{ id: 10, name: 'Round 1' }],
  teams: [{ id: 1, name: 'Alpha', round_scores: { 10: 3 }, total: 3 }],
};

function fakeSocket() {
  const handlers = {};
  return {
    on: vi.fn((ev, fn) => { handlers[ev] = fn; }),
    off: vi.fn(),
    trigger: (ev) => handlers[ev]?.(),
  };
}

beforeEach(() => {
  api.get.mockReset().mockResolvedValue(payload);
});

describe('LiveScoreboard (connected)', () => {
  it('fetches the breakdown and renders it', async () => {
    render(<LiveScoreboard sessionId={5} socket={null} />);
    expect(await screen.findByText('Alpha')).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith('/teams/session/5/scoreboard');
  });

  it('does not fetch without a sessionId', () => {
    render(<LiveScoreboard sessionId={null} socket={null} />);
    expect(api.get).not.toHaveBeenCalled();
  });

  it('re-fetches when a score/team socket event arrives and unsubscribes on unmount', async () => {
    const socket = fakeSocket();
    const { unmount } = render(<LiveScoreboard sessionId={5} socket={socket} />);
    await screen.findByText('Alpha');
    expect(api.get).toHaveBeenCalledTimes(1);

    socket.trigger('answer_marked');
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2));

    socket.trigger('team_updated');
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(3));

    unmount();
    expect(socket.off).toHaveBeenCalledWith('answer_marked', expect.any(Function));
  });
});
