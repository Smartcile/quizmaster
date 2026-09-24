import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

vi.mock('../components/DownloadFilesModal.jsx', () => ({ default: () => null }));
vi.mock('../hooks/useWebSocket', () => ({ useWebSocket: () => ({ connected: true, on: vi.fn(), off: vi.fn(), emit: vi.fn() }) }));
vi.mock('../services/api', () => ({ api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } }));

import { api } from '../services/api';
import QuizControl from './QuizControl.jsx';

const quiz = {
  name: 'Fixture Quiz',
  code: 'ABC123',
  items: [{
    kind: 'round', id: 1, name: 'Round One', style: 'standard',
    questions: [{ id: 11, text: 'Q1', type: 'text', answer: 'A', points: 1 }],
  }],
};

beforeEach(() => {
  api.get.mockReset().mockImplementation((path) => {
    if (path === '/config') return Promise.resolve({});
    if (path.startsWith('/quizzes/sessions/')) return Promise.resolve({ id: 5, status: 'active', current_slide_index: 0, locked_round_ids: [] });
    if (path.startsWith('/teams/session/')) return Promise.resolve([]);
    if (path.startsWith('/doubleup/session/')) return Promise.resolve({ choices: [] });
    return Promise.resolve([]);
  });
  api.put.mockReset().mockResolvedValue({});
});
afterEach(cleanup);

describe('QuizControl (active session)', () => {
  it('shows the quiz header, status, slide strip and host controls', async () => {
    render(<QuizControl sessionId={5} quiz={quiz} />);
    expect(await screen.findByText('ACTIVE')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Fixture Quiz' })).toBeInTheDocument();
    expect(screen.getByText('All Slides')).toBeInTheDocument();
    // Round group label from buildSlides
    expect(screen.getAllByText('Round One').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /End Quiz/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Quizzer Portal/i })).toBeInTheDocument();
  });
});
