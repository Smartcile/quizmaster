import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../services/api', () => ({ api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } }));
vi.mock('../hooks/useWebSocket', () => ({ useWebSocket: () => null }));
// AddTeamForm lives in QuizControl (a heavy page) — stub it.
vi.mock('./QuizControl.jsx', () => ({ AddTeamForm: () => null }));

import { api } from '../services/api';
import AnswerMarking from './AnswerMarking.jsx';

const baseData = {
  rounds: [{ id: 10, name: 'Round One', style: 'textlist' }],
  questions: [{
    id: 100, round_id: 10, text: 'Capital of France?', answer: 'Paris',
    points: 2, type: 'text', media_url: null, options: [], order: 1, answer_mode: 'text',
  }],
  teams: [{ id: 1, name: 'Alpha', size: 2, is_paper: false }],
  answers: [{ team_id: 1, question_id: 100, answer_text: 'Paris' }],
  scores: [],
  brownie: [],
};

function mockApi(data, { whoami = { whoami: null, guesses: [] } } = {}) {
  api.get.mockImplementation((path) => {
    const p = String(path ?? '');
    if (p.startsWith('/answers/session/')) return Promise.resolve(data);
    if (p.startsWith('/whoami/session/')) return Promise.resolve(whoami);
    if (p.startsWith('/doubleup/session/')) return Promise.resolve({ choices: [] });
    return Promise.resolve([]);
  });
}

beforeEach(() => api.get.mockReset());
afterEach(cleanup);

describe('AnswerMarking', () => {
  it('scales the score buttons to a 2-point question (half steps to full)', async () => {
    mockApi(baseData);
    render(<AnswerMarking sessionId={5} quiz={{}} />);
    expect(await screen.findByText('Capital of France?')).toBeInTheDocument();
    for (const v of ['0', '0.5', '1', '1.5', '2']) {
      expect(screen.getAllByRole('button', { name: v }).length).toBeGreaterThan(0);
    }
  });

  it('tags a text-list round with its Text badge', async () => {
    mockApi(baseData);
    render(<AnswerMarking sessionId={5} quiz={{}} />);
    expect(await screen.findByText('📋 Text')).toBeInTheDocument();
  });

  it('flags a manually-marked answer that the team has since changed', async () => {
    mockApi({ ...baseData, scores: [{ team_id: 1, question_id: 100, points_awarded: 1, auto_marked: false, marked_answer: 'London' }] });
    const { container } = render(<AnswerMarking sessionId={5} quiz={{}} />);
    expect(await screen.findByText(/changed since marked/)).toBeInTheDocument();
    expect(container.querySelector('.marking-team-row.answer-changed')).toBeTruthy();
  });

  it('never flags an auto-marked score (it re-evaluates server-side)', async () => {
    mockApi({ ...baseData, scores: [{ team_id: 1, question_id: 100, points_awarded: 2, auto_marked: true, marked_answer: 'Paris' }] });
    const { container } = render(<AnswerMarking sessionId={5} quiz={{}} />);
    await screen.findByText('Capital of France?');
    expect(screen.queryByText(/changed since marked/)).not.toBeInTheDocument();
    expect(container.querySelector('.marking-team-row.answer-changed')).toBeFalsy();
  });

  it('renders the Who Am I? marking section when the quiz has one', async () => {
    mockApi(baseData, {
      whoami: { whoami: { title: 'Who Am I?', answer: 'Einstein', clues: [{ text: 'c1', points: 5 }] }, guesses: [{ team_id: 1, guess_text: 'Einstein', locked_clue_index: 0, points_possible: 5, points_awarded: 5 }] },
    });
    render(<AnswerMarking sessionId={5} quiz={{}} />);
    expect((await screen.findAllByText(/Who Am I\?/)).length).toBeGreaterThan(0);
  });

  it('switches to a team-by-team view with the correct answer beside each team answer', async () => {
    mockApi(baseData);
    const user = userEvent.setup();
    const { container } = render(<AnswerMarking sessionId={5} quiz={{}} />);
    await screen.findByText('Capital of France?');
    await user.click(screen.getByRole('button', { name: 'By team' }));

    expect(container.querySelector('.marking-team-card')).toBeTruthy();
    // Correct answer + the team's own answer, both visible in the team card.
    expect(screen.getAllByText('Paris').length).toBeGreaterThan(1);
    // Score buttons are shared with the question view.
    expect(screen.getAllByRole('button', { name: '2' }).length).toBeGreaterThan(0);
  });

  it('collapses and expands a team card in the team view', async () => {
    mockApi(baseData);
    const user = userEvent.setup();
    const { container } = render(<AnswerMarking sessionId={5} quiz={{}} />);
    await screen.findByText('Capital of France?');
    await user.click(screen.getByRole('button', { name: 'By team' }));

    await user.click(screen.getByTitle('Collapse this team'));
    expect(container.querySelector('.marking-team-question')).toBeFalsy();
    expect(container.querySelector('.marking-round-collapsed')).toBeTruthy();

    await user.click(screen.getByTitle('Expand this team'));
    expect(container.querySelector('.marking-team-question')).toBeTruthy();
  });

  it('collapses and expands an individual round inside a team card', async () => {
    mockApi(baseData);
    const user = userEvent.setup();
    const { container } = render(<AnswerMarking sessionId={5} quiz={{}} />);
    await screen.findByText('Capital of France?');
    await user.click(screen.getByRole('button', { name: 'By team' }));

    await user.click(screen.getByTitle('Collapse this round'));
    expect(screen.queryByText('Capital of France?')).not.toBeInTheDocument();
    // The team header stays put.
    expect(container.querySelector('.marking-team-card')).toBeTruthy();

    await user.click(screen.getByTitle('Expand this round'));
    expect(screen.getByText('Capital of France?')).toBeInTheDocument();
  });
});
