import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Avoid pulling the heavy PDF/PPTX generators in via the Files modal.
vi.mock('../components/DownloadFilesModal.jsx', () => ({ default: () => null }));
vi.mock('../services/api', () => ({ api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } }));

import { api } from '../services/api';
import QuizBuilder from './QuizBuilder.jsx';

const rounds = [
  { id: 1, name: 'Alpha', category: 'Geography', questions: [{ id: 101 }] },
  { id: 2, name: 'Beta', category: 'Geography', questions: [{ id: 102 }] },
  { id: 3, name: 'Loose Round', category: null, questions: [] },
];
const masters = [{ id: 1, name: 'Default Profile', is_default: true }];

beforeEach(() => {
  api.get.mockReset();
  api.post.mockReset();
  api.put.mockReset();
  api.delete.mockReset();
  api.get.mockImplementation((path) => {
    if (path === '/quizzes') return Promise.resolve([]);
    if (path === '/rounds') return Promise.resolve(rounds);
    if (path === '/masters') return Promise.resolve(masters);
    if (path === '/questions') return Promise.resolve([]);
    return Promise.resolve([]);
  });
});

const addRound = async (user, name) => user.click(await screen.findByTitle(`Add "${name}" to quiz`));

describe('QuizBuilder — Available Rounds grouping', () => {
  it('groups rounds by category, with uncategorised last, and collapse-all works', async () => {
    const user = userEvent.setup();
    render(<QuizBuilder />);

    const geo = await screen.findByText('Geography');
    const uncategorised = screen.getByText('Uncategorised');
    expect(geo).toBeInTheDocument();
    expect(uncategorised).toBeInTheDocument();

    // Category groups render their rounds; uncategorised group sorts last.
    expect(screen.getByTitle('Add "Alpha" to quiz')).toBeInTheDocument();
    expect(screen.getByTitle('Add "Loose Round" to quiz')).toBeInTheDocument();

    // Collapse all hides the chips…
    await user.click(screen.getByRole('button', { name: /Collapse all/i }));
    expect(screen.queryByTitle('Add "Alpha" to quiz')).not.toBeInTheDocument();
    // …and expand brings them back.
    await user.click(screen.getByRole('button', { name: /Expand all/i }));
    expect(screen.getByTitle('Add "Alpha" to quiz')).toBeInTheDocument();
  });

  it('adds rounds to the quiz order and updates the count', async () => {
    const user = userEvent.setup();
    render(<QuizBuilder />);
    await user.type(screen.getByPlaceholderText(/Quiz name/i), 'My Quiz');
    await addRound(user, 'Alpha');
    await addRound(user, 'Beta');
    expect(await screen.findByRole('button', { name: /Create Quiz \(2 items\)/i })).toBeEnabled();
    // Added rounds disappear from the picker
    expect(screen.queryByTitle('Add "Alpha" to quiz')).not.toBeInTheDocument();
  });
});

describe('QuizBuilder — duplicate question guard', () => {
  it('blocks saving and warns when the same question appears in two rounds', async () => {
    api.get.mockImplementation((path) => {
      if (path === '/rounds') return Promise.resolve([
        { id: 1, name: 'Alpha', category: null, questions: [{ id: 999 }] },
        { id: 2, name: 'Beta', category: null, questions: [{ id: 999 }] },  // same question
      ]);
      if (path === '/quizzes') return Promise.resolve([]);
      if (path === '/masters') return Promise.resolve(masters);
      if (path === '/questions') return Promise.resolve([]);
      return Promise.resolve([]);
    });
    const user = userEvent.setup();
    render(<QuizBuilder />);

    await addRound(user, 'Alpha');
    await addRound(user, 'Beta');

    expect(await screen.findByText(/duplicate question/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Create Quiz/i })).toBeDisabled();
  });
});
