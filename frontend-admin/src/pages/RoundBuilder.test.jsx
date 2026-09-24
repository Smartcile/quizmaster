import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../services/api', () => ({ api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } }));

import { api } from '../services/api';
import RoundBuilder from './RoundBuilder.jsx';

beforeEach(() => {
  api.get.mockReset().mockImplementation((path) => {
    if (path === '/rounds') return Promise.resolve([]);
    if (path === '/questions') return Promise.resolve([]);
    if (path === '/questions/categories') return Promise.resolve(['Geography', 'History']);
    return Promise.resolve([]);
  });
  api.post.mockReset().mockResolvedValue({ id: 1 });
});
afterEach(cleanup);

async function openCreate() {
  const user = userEvent.setup();
  render(<RoundBuilder />);
  await user.click(await screen.findByRole('button', { name: /\+ Create Round/i }));
  return user;
}

describe('RoundBuilder — round style + category', () => {
  it('saves a textlist round with its mode, shared options and category', async () => {
    const user = await openCreate();

    await user.type(screen.getByPlaceholderText(/Round name/i), 'Geo List');
    // Style select currently shows "Standard round".
    await user.selectOptions(screen.getByText('Standard round').closest('select'), 'textlist');
    // Category (optional) input
    await user.type(screen.getByPlaceholderText(/Category \(optional\)/i), 'Geography');

    // The textlist config now appears — pick match mode and the shared options.
    await user.selectOptions(screen.getByText('Plain text answers').closest('select'), 'match');
    const optsBox = screen.getByPlaceholderText(/Small/i);
    fireEvent.change(optsBox, { target: { value: 'Small\nMedium\nLarge' } });
    // Opt in to showing each item's image (on screen + answer sheet).
    await user.click(screen.getByLabelText(/Show item images/i));

    await user.click(screen.getByRole('button', { name: 'Create Round' }));

    expect(api.post).toHaveBeenCalledWith('/rounds', expect.objectContaining({
      name: 'Geo List',
      style: 'textlist',
      category: 'Geography',
      list_mode: 'match',
      list_options: ['Small', 'Medium', 'Large'],
      show_images: true,
    }));
  });

  it('lists a saved textlist round with Text-list + category badges', async () => {
    api.get.mockImplementation((path) => {
      if (path === '/rounds') return Promise.resolve([
        { id: 1, name: 'Geo List', style: 'textlist', display_title: null, category: 'Geography', list_mode: 'match', list_options: ['S', 'M'], questions: [] },
      ]);
      if (path === '/questions') return Promise.resolve([]);
      if (path === '/questions/categories') return Promise.resolve(['Geography']);
      return Promise.resolve([]);
    });
    render(<RoundBuilder />);
    expect(await screen.findByText('Geo List')).toBeInTheDocument();
    expect(screen.getByText('📋 Text list')).toBeInTheDocument();
    expect(screen.getByText('Geography')).toBeInTheDocument();
  });
});

describe('RoundBuilder — rounds grouped by quiz', () => {
  const rounds = [
    { id: 1, name: 'Alpha Round', style: 'standard', questions: [], quizzes: [{ id: 10, name: 'Friday Quiz', position: 0, created_at: '2026-02-01' }] },
    { id: 2, name: 'Shared Round', style: 'standard', questions: [], quizzes: [
      { id: 10, name: 'Friday Quiz', position: 1, created_at: '2026-02-01' },
      { id: 11, name: 'Sunday Quiz', position: 0, created_at: '2026-01-01' },
    ] },
    { id: 3, name: 'Orphan Round', style: 'standard', questions: [], quizzes: [] },
  ];

  function mockRounds(list = rounds) {
    api.get.mockImplementation((path) => {
      if (path === '/rounds') return Promise.resolve(list);
      if (path === '/questions') return Promise.resolve([]);
      if (path === '/questions/categories') return Promise.resolve([]);
      return Promise.resolve([]);
    });
  }

  it('groups by quiz (newest first), shows shared rounds in each, and puts unassigned last', async () => {
    mockRounds();
    render(<RoundBuilder />);

    expect(await screen.findByText('Alpha Round')).toBeInTheDocument();

    const friday = screen.getByRole('button', { name: /Friday Quiz/i });
    const sunday = screen.getByRole('button', { name: /Sunday Quiz/i });
    const none   = screen.getByRole('button', { name: /Not in a quiz/i });

    // Order: Friday (newest) → Sunday → Not in a quiz
    expect(friday.compareDocumentPosition(sunday) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(sunday.compareDocumentPosition(none)   & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    // The shared round appears under both quizzes; the orphan only under "Not in a quiz".
    expect(screen.getAllByText('Shared Round')).toHaveLength(2);
    expect(screen.getByText('Orphan Round')).toBeInTheDocument();
  });

  it('collapses and expands a quiz group', async () => {
    mockRounds();
    const user = userEvent.setup();
    render(<RoundBuilder />);
    expect(await screen.findByText('Alpha Round')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Friday Quiz/i }));
    // Friday group's rounds are hidden…
    expect(screen.queryByText('Alpha Round')).not.toBeInTheDocument();
    // …but the shared round remains visible under the Sunday group.
    expect(screen.getAllByText('Shared Round')).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: /Friday Quiz/i }));
    expect(screen.getByText('Alpha Round')).toBeInTheDocument();
    expect(screen.getAllByText('Shared Round')).toHaveLength(2);
  });

  it('Flat list shows every round once with no group headers', async () => {
    mockRounds();
    const user = userEvent.setup();
    render(<RoundBuilder />);
    expect(await screen.findByText('Alpha Round')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Flat list' }));

    expect(screen.queryByRole('button', { name: /Friday Quiz/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Not in a quiz/i })).not.toBeInTheDocument();
    expect(screen.getByText('Alpha Round')).toBeInTheDocument();
    expect(screen.getByText('Orphan Round')).toBeInTheDocument();
    // Each round is rendered exactly once in the flat list.
    expect(screen.getAllByText('Shared Round')).toHaveLength(1);
  });
});
