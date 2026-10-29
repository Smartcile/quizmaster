import { describe, it, expect } from 'vitest';
import { buildSlides, slideShortLabel } from '../frontend-admin/src/utils/buildSlides.js';
import { makeQuiz, EXPECTED_TYPES } from './fixtures.js';

// buildSlides is the keystone of the app: the WebSocket only ships a slide
// INDEX, so every surface must derive the exact same array from the same quiz.
describe('buildSlides — ordering', () => {
  it('produces the full expected slide sequence for a mixed quiz', () => {
    const slides = buildSlides(makeQuiz());
    expect(slides.map(s => s.type)).toEqual(EXPECTED_TYPES);
  });

  it('starts with an intro carrying the quiz name + code, ends with the whoami answer', () => {
    const slides = buildSlides(makeQuiz());
    expect(slides[0]).toMatchObject({ type: 'intro', title: 'Fixture Quiz' });
    expect(slides[0].subtitle).toContain('ABC123');
    const end = slides[slides.length - 1];
    expect(end.type).toBe('end');
    expect(end.whoami).toEqual({ title: 'Who Am I?', answer: 'Einstein' });
  });

  it('never renders the whoami widget at its drop position', () => {
    const slides = buildSlides(makeQuiz());
    const whoamiWidgetSlides = slides.filter(s => s.type === 'widget' && s.widgetType === 'whoami');
    expect(whoamiWidgetSlides).toHaveLength(0);
  });

  it('falls back to rounds-then-widgets when quiz.items is absent (backward compat)', () => {
    const { items, ...noItems } = makeQuiz();
    const legacy = {
      ...noItems,
      rounds: items.filter(i => i.kind === 'round'),
      widgets: items.filter(i => i.kind === 'widget'),
    };
    const slides = buildSlides(legacy);
    const types = slides.map(s => s.type);
    // Same set of slides as the interleaved version…
    expect([...types].sort()).toEqual([...EXPECTED_TYPES].sort());
    // …but every round comes first, then the widgets (legacy fixed ordering).
    const lastRoundSlide = Math.max(...slides.map((s, i) => (s.roundId ? i : -1)));
    const scoreboard = slides.findIndex(s => s.type === 'widget' && s.widgetType === 'scoreboard');
    expect(scoreboard).toBeGreaterThan(lastRoundSlide);
    expect(types[0]).toBe('intro');
    expect(types[types.length - 1]).toBe('end');
  });
});

describe('buildSlides — Who Am I? clue distribution', () => {
  it('reveals one clue before each round, bounded by the clue count', () => {
    const slides = buildSlides(makeQuiz());
    const clues = slides.filter(s => s.type === 'whoami_clue');
    // 4 rounds but only 3 clues → 3 clue slides.
    expect(clues).toHaveLength(3);
    expect(clues.map(c => c.clueIndex)).toEqual([0, 1, 2]);
    expect(clues[0]).toMatchObject({ title: 'Who Am I?', text: 'C1', points: 5, totalClues: 3 });
    expect(clues[0].revealed).toHaveLength(1);
    expect(clues[2].revealed).toHaveLength(3);
    // Each clue slide is immediately followed by that round's content.
    expect(slides[1].type).toBe('whoami_clue');   // before round 1
    expect(slides[9].type).toBe('whoami_clue');   // before round 2
    expect(slides[14].type).toBe('whoami_clue');  // before round 3
  });
});

describe('buildSlides — round expansion', () => {
  it('expands a standard round to intro + per-question slides', () => {
    const slides = buildSlides(makeQuiz());
    const q = slides.find(s => s.type === 'question' && s.questionId === 102);
    expect(q).toMatchObject({
      roundId: 10, questionNumber: 2, totalInRound: 2, answerMode: 'mcq',
      text: 'Q2', points: 2, options: ['A', 'B'],
    });
  });

  it('expands an intermission round to ONE grid slide (not per-question slides)', () => {
    const slides = buildSlides(makeQuiz());
    const grid = slides.find(s => s.type === 'intermission');
    expect(grid).toMatchObject({ roundId: 20, title: 'Name the Picture', gridColumns: 4 });
    expect(grid.questions).toHaveLength(2);
    expect(grid.questions[0]).toMatchObject({ questionId: 201, questionNumber: 1, mediaUrl: '/u/1.jpg' });
    expect(slides.filter(s => s.type === 'question' && s.roundId === 20)).toHaveLength(0);
  });

  it('expands a textlist round to ONE slide carrying its mode + options', () => {
    const slides = buildSlides(makeQuiz());
    const order = slides.find(s => s.type === 'textlist' && s.roundId === 30);
    expect(order).toMatchObject({ title: 'Order by size', listMode: 'order', listOptions: [] });
    expect(order.questions).toHaveLength(2);

    const match = slides.find(s => s.type === 'textlist' && s.roundId === 40);
    expect(match).toMatchObject({ listMode: 'match', listOptions: ['Small', 'Large'] });
    expect(match.questions[0]).toMatchObject({ questionId: 401, text: 'Luxembourg', answer: 'Small' });
  });

  it('carries the textlist show_images flag onto its slide', () => {
    const quiz = {
      name: 'x', code: 'XXXXXX',
      items: [{
        kind: 'round', id: 1, name: 'Pic List', style: 'textlist', show_images: true, list_mode: 'plain',
        questions: [{ id: 1, text: 'One', type: 'image', media_url: '/u/1.jpg', answer: 'a', points: 1 }],
      }],
    };
    const slide = buildSlides(quiz).find(s => s.type === 'textlist');
    expect(slide.showImages).toBe(true);
    expect(slide.questions[0]).toMatchObject({ mediaUrl: '/u/1.jpg', questionType: 'image' });
  });

  it('defaults showImages to false when the round does not set it', () => {
    const quiz = {
      name: 'x', code: 'XXXXXX',
      items: [{ kind: 'round', id: 1, name: 'Plain List', style: 'textlist', questions: [{ id: 1, text: 'One', type: 'text', answer: 'a' }] }],
    };
    expect(buildSlides(quiz).find(s => s.type === 'textlist').showImages).toBe(false);
  });

  it('inserts mark_answers after the questions and before the reveals', () => {
    const slides = buildSlides(makeQuiz());
    const markIdx = slides.findIndex(s => s.type === 'mark_answers' && s.roundId === 10);
    const firstQ = slides.findIndex(s => s.type === 'question' && s.roundId === 10);
    const firstA = slides.findIndex(s => s.type === 'answer' && s.roundId === 10);
    expect(firstQ).toBeLessThan(markIdx);
    expect(markIdx).toBeLessThan(firstA);
    expect(slides[markIdx]).toMatchObject({ roundName: 'Round One', totalInRound: 2 });
  });

  it('flags intermission answer reveals and names them by display title', () => {
    const slides = buildSlides(makeQuiz());
    const a = slides.find(s => s.type === 'answer' && s.roundId === 20);
    expect(a.intermission).toBe(true);
    expect(a.roundName).toBe('Name the Picture');
    const std = slides.find(s => s.type === 'answer' && s.roundId === 10);
    expect(std.intermission).toBe(false);
    expect(std.roundName).toBe('Round One');
  });

  it('carries the full picture onto a close-up answer reveal', () => {
    const slides = buildSlides(makeQuiz());
    const cropped = slides.find(s => s.type === 'answer' && s.questionId === 201);
    expect(cropped).toMatchObject({ mediaUrl: '/u/1.jpg', answerMediaUrl: '/u/full-1.jpg' });
    const plain = slides.find(s => s.type === 'answer' && s.questionId === 202);
    expect(plain.answerMediaUrl).toBeNull();
  });
});

describe('buildSlides — edge cases', () => {
  it('returns [] for a null quiz', () => {
    expect(buildSlides(null)).toEqual([]);
  });

  it('parses widget data supplied as a JSON string', () => {
    const quiz = { name: 'x', code: 'XXXXXX', items: [{ kind: 'widget', id: 1, type: 'rules', data: '{"title":"Rules!"}' }] };
    const slides = buildSlides(quiz);
    expect(slides.find(s => s.type === 'widget').data).toEqual({ title: 'Rules!' });
  });

  it('drops questions without an id', () => {
    const quiz = { name: 'x', code: 'XXXXXX', items: [{ kind: 'round', id: 1, name: 'R', style: 'standard', questions: [{ text: 'no id' }, { id: 2, text: 'ok' }] }] };
    const slides = buildSlides(quiz);
    expect(slides.filter(s => s.type === 'question')).toHaveLength(1);
  });

  it('labels the new textlist slide type', () => {
    expect(slideShortLabel({ type: 'textlist', title: 'Order by size' })).toBe('Text Round: Order by size');
    expect(slideShortLabel({ type: 'intermission', title: 'Pics' })).toBe('Picture Round: Pics');
  });
});
