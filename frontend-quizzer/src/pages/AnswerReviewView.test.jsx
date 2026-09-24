import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AnswerReviewView } from './QuizParticipant.jsx';

// The end-of-quiz Answer Review page: every answer grouped by round + the score.
describe('AnswerReviewView', () => {
  const slides = [
    { type: 'question', roundId: 1, questionId: 11, questionNumber: 1, roundName: 'Round One', text: 'Capital of France?' },
    { type: 'textlist', roundId: 2, title: 'List Round', questions: [{ questionId: 21, questionNumber: 1, text: 'Canada' }] },
  ];
  const answers = { 11: 'Paris', 21: 'Small' };
  const scores  = { 11: 1, 21: 0.5 };

  it('groups answers by round (incl. textlist) and totals the scores', () => {
    const { container } = render(<AnswerReviewView title="Your Answers" slides={slides} answers={answers} scores={scores} />);
    expect(screen.getByText('Round One')).toBeInTheDocument();
    expect(screen.getByText('List Round')).toBeInTheDocument();
    expect(screen.getByText('Paris')).toBeInTheDocument();
    expect(screen.getByText('Small')).toBeInTheDocument();
    expect(screen.getByText(/Round total:/)).toHaveTextContent('1.5');
    // Colour-coded result rows: 1 → correct, 0.5 → half
    expect(container.querySelectorAll('.answer-correct').length).toBe(1);
    expect(container.querySelectorAll('.answer-half').length).toBe(1);
  });

  it('shows "(no answer)" and a dash for an unmarked question', () => {
    render(<AnswerReviewView title="Your Answers" slides={slides} answers={{}} scores={{}} />);
    expect(screen.getAllByText('(no answer)').length).toBeGreaterThan(0);
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });
});
