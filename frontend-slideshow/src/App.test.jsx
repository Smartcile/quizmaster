import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { SlideRenderer } from './App.jsx';

afterEach(cleanup);

const renderSlide = (slide) => render(<SlideRenderer slide={slide} slideIndex={0} />);

describe('SlideRenderer', () => {
  it('renders the intro title + code', () => {
    renderSlide({ type: 'intro', title: 'Welcome', subtitle: 'Quiz Code: ABC123' });
    expect(screen.getByText('Welcome')).toBeInTheDocument();
    expect(screen.getByText('Quiz Code: ABC123')).toBeInTheDocument();
  });

  it('renders a multiple-choice question with lettered options', () => {
    renderSlide({
      type: 'question', roundName: 'R1', questionNumber: 1, totalInRound: 2, points: 1,
      text: 'Capital of France?', answerMode: 'mcq', questionType: 'text', options: ['Paris', 'London'],
    });
    expect(screen.getByText('Capital of France?')).toBeInTheDocument();
    expect(screen.getByText('Paris')).toBeInTheDocument();
    expect(screen.getByText('London')).toBeInTheDocument();
  });

  it('renders a text-list round with its match legend + items', () => {
    renderSlide({
      type: 'textlist', title: 'Match Round', listMode: 'match', listOptions: ['Small', 'Large'],
      questions: [{ questionId: 1, questionNumber: 1, text: 'Luxembourg' }],
    });
    expect(screen.getByText('Match Round')).toBeInTheDocument();
    expect(screen.getByText('Small')).toBeInTheDocument();
    expect(screen.getByText('Large')).toBeInTheDocument();
    expect(screen.getByText('Luxembourg')).toBeInTheDocument();
    expect(screen.getByText(/Match each item/i)).toBeInTheDocument();
  });

  it('renders an intermission picture grid', () => {
    renderSlide({
      type: 'intermission', title: 'Picture Round', gridColumns: 4,
      questions: [
        { questionId: 1, questionNumber: 1, questionType: 'image', mediaUrl: '/u/a.jpg', text: 'a' },
        { questionId: 2, questionNumber: 2, questionType: 'image', mediaUrl: '', text: 'mystery' },
      ],
    });
    expect(screen.getByText('Picture Round')).toBeInTheDocument();
    // A missing image falls back to its text rather than a blank cell
    expect(screen.getByText('mystery')).toBeInTheDocument();
  });

  it('reveals the plain answer on the answer slide', () => {
    renderSlide({ type: 'answer', roundName: 'R1', questionNumber: 1, text: 'Capital?', answer: 'Paris', intermission: false, questionType: 'text' });
    expect(screen.getByText('Paris')).toBeInTheDocument();
    expect(screen.getByText('Capital?')).toBeInTheDocument();
  });
});
