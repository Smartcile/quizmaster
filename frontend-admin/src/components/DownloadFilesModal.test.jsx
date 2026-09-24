import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../services/api', () => ({ api: { get: vi.fn() } }));
vi.mock('../utils/quizFiles', () => ({
  downloadAnswerSheet: vi.fn(),
  downloadQuestionsAnswers: vi.fn(),
  downloadMarkingForm: vi.fn(),
  downloadSlideshowPptx: vi.fn(),
}));

import { api } from '../services/api';
import { downloadAnswerSheet, downloadQuestionsAnswers } from '../utils/quizFiles';
import DownloadFilesModal from './DownloadFilesModal.jsx';

beforeEach(() => {
  api.get.mockReset().mockResolvedValue({ id: 1, name: 'Quiz A', items: [] });
  downloadAnswerSheet.mockReset().mockResolvedValue();
  downloadQuestionsAnswers.mockReset().mockResolvedValue();
});
afterEach(cleanup);

describe('DownloadFilesModal', () => {
  it('fetches the full quiz and runs the matching generator', async () => {
    const user = userEvent.setup();
    render(<DownloadFilesModal quizId={1} onClose={vi.fn()} />);
    expect(api.get).toHaveBeenCalledWith('/quizzes/1');
    await screen.findByText(/Download Quiz Files — Quiz A/i);

    await user.click(screen.getAllByRole('button', { name: /Download$/i })[0]);
    expect(downloadAnswerSheet).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }));
  });

  it('surfaces a generator error', async () => {
    downloadQuestionsAnswers.mockRejectedValue(new Error('boom'));
    const user = userEvent.setup();
    render(<DownloadFilesModal quizId={1} onClose={vi.fn()} />);
    await screen.findByText(/Download Quiz Files/i);
    await user.click(screen.getAllByRole('button', { name: /Download$/i })[1]);
    expect(await screen.findByText(/Could not generate that file: boom/i)).toBeInTheDocument();
  });
});
