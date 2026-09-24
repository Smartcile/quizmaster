import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import JoinQuiz from './JoinQuiz.jsx';

beforeEach(() => window.history.replaceState({}, '', '/'));
afterEach(cleanup);

describe('JoinQuiz', () => {
  it('pre-fills the code from a URL path segment (upper-cased)', () => {
    window.history.replaceState({}, '', '/abc123');
    render(<JoinQuiz onJoin={vi.fn()} />);
    expect(screen.getByPlaceholderText('ABC123')).toHaveValue('ABC123');
  });

  it('pre-fills from a legacy ?code= query param', () => {
    window.history.replaceState({}, '', '/?code=xyz789');
    render(<JoinQuiz onJoin={vi.fn()} />);
    expect(screen.getByPlaceholderText('ABC123')).toHaveValue('XYZ789');
  });

  it('submits the upper-cased code, team name and size', () => {
    const onJoin = vi.fn().mockResolvedValue(true);
    render(<JoinQuiz onJoin={onJoin} />);
    fireEvent.change(screen.getByPlaceholderText('ABC123'), { target: { value: 'abc123' } });
    fireEvent.change(screen.getByPlaceholderText(/Quizinators/i), { target: { value: 'The Kings' } });
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '4' } });
    fireEvent.click(screen.getByRole('button', { name: /Join Quiz/i }));
    expect(onJoin).toHaveBeenCalledWith('ABC123', 'The Kings', 4);
  });

  it('shows the error passed in by the app', () => {
    render(<JoinQuiz onJoin={vi.fn()} error="Code not found." />);
    expect(screen.getByText('Code not found.')).toBeInTheDocument();
  });
});
