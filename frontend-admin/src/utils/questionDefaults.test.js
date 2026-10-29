import { describe, it, expect, beforeEach } from 'vitest';

import { applyQuestionDefaults, saveQuestionDefaults } from './questionDefaults.js';

const BASE = {
  text: '',
  answer: '',
  type: 'text',
  points: 1,
  media_url: '',
  category: '',
  difficulty: 'medium',
  answer_mode: 'text',
  audio_form: '',
  approved: false,
  options: ['', '', '', ''],
  clues: [{ text: '', points: 1 }]
};

beforeEach(() => localStorage.clear());

describe('question defaults', () => {
  it('carries the settings but never the text, answer, media or options', () => {
    saveQuestionDefaults({
      ...BASE,
      text: 'Capital of France?',
      answer: 'Paris',
      media_url: '/uploads/baguette.jpg',
      type: 'image',
      points: 2,
      category: 'Geography',
      difficulty: 'hard',
      answer_mode: 'mcq',
      approved: true,
      options: ['Paris', 'Lyon'],
      clues: [{ text: 'I am a city', points: 3 }]
    });

    const next = applyQuestionDefaults(BASE);
    expect(next).toMatchObject({
      type: 'image',
      points: 2,
      category: 'Geography',
      difficulty: 'hard',
      answer_mode: 'mcq',
      approved: true
    });
    expect(next.text).toBe('');
    expect(next.answer).toBe('');
    expect(next.media_url).toBe('');
    expect(next.options).toEqual(BASE.options);
    expect(next.clues).toEqual(BASE.clues);
  });

  it('returns the base form untouched when nothing is stored', () => {
    expect(applyQuestionDefaults(BASE)).toEqual(BASE);
  });
});
