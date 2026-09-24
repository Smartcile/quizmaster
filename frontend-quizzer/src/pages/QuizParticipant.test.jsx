import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';

vi.mock('../services/api', () => ({ api: { get: vi.fn(), post: vi.fn() } }));

import { api } from '../services/api';
import QuizParticipant from './QuizParticipant.jsx';

const quiz = {
  name: 'Fixture',
  code: 'ABC123',
  items: [{
    kind: 'round', id: 1, name: 'Round One', style: 'standard',
    questions: [{ id: 11, text: 'Capital of France?', type: 'text', answer: 'Paris', points: 1, answer_mode: 'text' }],
  }],
};

function fakeSocket() {
  const handlers = {};
  return {
    connected: true,
    handlers,
    on: vi.fn((ev, fn) => { handlers[ev] = fn; }),
    off: vi.fn(),
    emit: vi.fn(),
    trigger(ev, data) { handlers[ev]?.(data); },
  };
}

beforeEach(() => {
  api.get.mockReset().mockImplementation((path) => {
    if (path.endsWith('/scores')) return Promise.resolve({ scores: [] });
    if (path.endsWith('/answers')) return Promise.resolve([]);
    if (path.startsWith('/whoami/session/')) return Promise.resolve({ whoami: null, guesses: [] });
    if (path.startsWith('/doubleup/session/')) return Promise.resolve({ choices: [] });
    return Promise.resolve([]);
  });
  api.post.mockReset().mockResolvedValue({});
});
afterEach(cleanup);

const renderAt = (socket, currentSlide = 2) =>
  render(<QuizParticipant quiz={quiz} sessionId={5} team={{ id: 1, name: 'Alpha' }} currentSlide={currentSlide} socket={socket} />);

describe('QuizParticipant — answering', () => {
  it('renders the current question and emits submit_answer on input', async () => {
    const socket = fakeSocket();
    renderAt(socket);
    const input = await screen.findByPlaceholderText(/Type your answer/i);
    expect(screen.getByText('Capital of France?')).toBeInTheDocument();

    fireEvent.change(input, { target: { value: 'Paris' } });
    expect(socket.emit).toHaveBeenCalledWith('submit_answer', {
      sessionId: 5, teamId: 1, questionId: 11, roundId: 1, answer: 'Paris',
    });
  });

  it('disables the input and shows the locked badge when the round is locked', async () => {
    const socket = fakeSocket();
    renderAt(socket);
    const input = await screen.findByPlaceholderText(/Type your answer/i);

    act(() => socket.trigger('answer_locked', { roundId: 1 }));
    expect(input).toBeDisabled();
    expect(screen.getByText(/Answer locked/i)).toBeInTheDocument();
  });
});

describe('QuizParticipant — Who Am I? lock-in', () => {
  // Slide index 1 is the whoami_clue (directly before the round intro).
  const whoamiQuiz = {
    name: 'W', code: 'ZZZZZZ',
    items: [
      { kind: 'widget', id: 9, type: 'whoami', data: { title: 'Who Am I?', answer: 'Einstein', clues: [{ text: 'A famous physicist', points: 5 }] } },
      { kind: 'round', id: 1, name: 'Round One', style: 'standard', questions: [{ id: 11, text: 'Q', type: 'text', answer: 'A', points: 1 }] },
    ],
  };

  it('locks in a guess via POST /whoami/lock', async () => {
    api.post.mockResolvedValue({ locked: true, guess_text: 'Einstein', locked_clue_index: 0, points_possible: 5, points_awarded: 5 });
    const socket = fakeSocket();
    render(<QuizParticipant quiz={whoamiQuiz} sessionId={5} team={{ id: 1, name: 'Alpha' }} currentSlide={1} socket={socket} />);

    const box = await screen.findByPlaceholderText(/Your guess/i);
    fireEvent.change(box, { target: { value: 'Einstein' } });
    fireEvent.click(screen.getByRole('button', { name: /Lock in for 5/i }));

    expect(api.post).toHaveBeenCalledWith('/whoami/lock', { sessionId: 5, teamId: 1, clueIndex: 0, guess: 'Einstein' });
    expect(await screen.findByText(/Locked in on clue 1/i)).toBeInTheDocument();
  });
});
