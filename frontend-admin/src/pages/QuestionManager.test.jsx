import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Heavy media editors aren't relevant here — stub them so the page loads fast.
vi.mock('../components/MediaPicker.jsx', () => ({ default: () => null }));
vi.mock('../components/AudioEditor.jsx', () => ({ default: () => null }));
vi.mock('../components/VideoEditor.jsx', () => ({ default: () => null }));
vi.mock('../services/api', () => ({ api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } }));

import { api } from '../services/api';
import QuestionManager from './QuestionManager.jsx';

beforeEach(() => {
  api.get.mockReset().mockImplementation(() => Promise.resolve([]));
  api.post.mockReset().mockResolvedValue({ id: 1 });
});
afterEach(cleanup);

// Render + return the editor form scope (the page also has filter selects with
// overlapping option labels, so queries must be scoped to the editor form).
function renderEditor() {
  const { container } = render(<QuestionManager />);
  return within(container.querySelector('form'));
}

describe('QuestionManager — MCQ answer selection', () => {
  it('ticks the correct option and hides the free-text box for pure MCQ', async () => {
    const user = userEvent.setup();
    const form = renderEditor();
    await user.selectOptions(form.getByText('Text answer only').closest('select'), 'mcq');

    await user.type(form.getByPlaceholderText('Option A'), 'Paris');
    await user.type(form.getByPlaceholderText('Option B'), 'London');
    await user.click(form.getAllByRole('radio')[0]);   // tick A

    expect(form.getByText('A', { selector: '.mcq-letter-tag' })).toBeInTheDocument();
    expect(form.queryByPlaceholderText(/type it by hand/i)).not.toBeInTheDocument();
  });

  it('keeps the free-text fallback for "Both" questions', async () => {
    const user = userEvent.setup();
    const form = renderEditor();
    await user.selectOptions(form.getByText('Text answer only').closest('select'), 'both');
    expect(await form.findByPlaceholderText(/type it by hand/i)).toBeInTheDocument();
  });

  it('blocks saving a pure-MCQ question until an option is ticked', async () => {
    const user = userEvent.setup();
    const form = renderEditor();
    await user.type(form.getByPlaceholderText(/capital of France/i), 'Capital of France?');
    await user.selectOptions(form.getByText('Text answer only').closest('select'), 'mcq');
    await user.click(form.getByRole('button', { name: /Add Question/i }));
    // Error banner is rendered at page level (outside the form)
    expect(await screen.findByText(/Tick the correct option\./, { selector: '.error-banner' })).toBeInTheDocument();
  });
});
