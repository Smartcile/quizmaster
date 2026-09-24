import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../services/api', () => ({ api: { get: vi.fn() } }));

import { api } from '../services/api';
import QuizQrModal from './QuizQrModal.jsx';

beforeEach(() => {
  api.get.mockReset().mockResolvedValue({ quizzerUrl: 'https://answer.test/' });
});
afterEach(cleanup);

describe('QuizQrModal', () => {
  it('builds the join URL from the config base + quiz code', async () => {
    render(<QuizQrModal quiz={{ name: 'Quiz A', code: 'ABC123' }} onClose={vi.fn()} />);
    expect(await screen.findByText('https://answer.test/ABC123')).toBeInTheDocument();
    expect(screen.getByText('ABC123')).toBeInTheDocument();
  });

  it('prints a standalone sheet carrying the code and URL', async () => {
    const win = { document: { write: vi.fn(), close: vi.fn() }, focus: vi.fn(), print: vi.fn() };
    vi.spyOn(window, 'open').mockReturnValue(win);
    const user = userEvent.setup();
    render(<QuizQrModal quiz={{ name: 'Quiz A', code: 'ABC123' }} onClose={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: /Print/i }));
    expect(window.open).toHaveBeenCalled();
    const html = win.document.write.mock.calls[0][0];
    expect(html).toContain('ABC123');
    expect(html).toContain('https://answer.test/ABC123');
  });

  it('calls onClose', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<QuizQrModal quiz={{ name: 'Quiz A', code: 'ABC123' }} onClose={onClose} />);
    await user.click(screen.getByRole('button', { name: /^Close$/i }));
    expect(onClose).toHaveBeenCalled();
  });
});
