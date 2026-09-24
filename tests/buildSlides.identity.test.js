import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildSlides as adminSlides, slideShortLabel as adminLabel } from '../frontend-admin/src/utils/buildSlides.js';
import { buildSlides as slideshowSlides, slideShortLabel as slideshowLabel } from '../frontend-slideshow/src/utils/buildSlides.js';
import { buildSlides as quizzerSlides, slideShortLabel as quizzerLabel } from '../frontend-quizzer/src/utils/buildSlides.js';

import { makeQuiz } from './fixtures.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const copyPaths = ['frontend-admin', 'frontend-slideshow', 'frontend-quizzer']
  .map(p => path.join(repoRoot, p, 'src', 'utils', 'buildSlides.js'));

const readNormalized = (file) =>
  fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');

// THE ONE RULE: the three buildSlides.js copies must stay identical, otherwise
// the same slide index shows different content on admin vs slideshow vs quizzer.
describe('buildSlides — the One Rule (three identical copies)', () => {
  it('all three source files are byte-identical (line endings normalised)', () => {
    const [a, b, c] = copyPaths.map(readNormalized);
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it('all three copies produce deep-equal output for the same quiz', () => {
    const quiz = makeQuiz();
    const a = JSON.stringify(adminSlides(quiz));
    const b = JSON.stringify(slideshowSlides(quiz));
    const c = JSON.stringify(quizzerSlides(quiz));
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it('stays in sync for a quiz where clues outnumber rounds', () => {
    const quiz = {
      name: 'Q', code: 'ZZZZZZ',
      items: [
        { kind: 'round', id: 1, name: 'R1', style: 'standard', questions: [{ id: 1, text: 'a', answer: 'a' }] },
        { kind: 'widget', id: 2, type: 'whoami', data: { answer: 'X', clues: [{ text: 'c1', points: 3 }, { text: 'c2', points: 1 }] } },
      ],
    };
    expect(JSON.stringify(adminSlides(quiz))).toBe(JSON.stringify(quizzerSlides(quiz)));
    expect(JSON.stringify(adminSlides(quiz))).toBe(JSON.stringify(slideshowSlides(quiz)));
  });

  it('short-label helpers are identical too', () => {
    const samples = [
      { type: 'intro' }, { type: 'intermission', title: 'P' }, { type: 'textlist', title: 'T' },
      { type: 'round_intro', title: 'R' }, { type: 'question', questionNumber: 1, roundName: 'R' },
      { type: 'mark_answers', roundName: 'R' }, { type: 'answer', questionNumber: 1, roundName: 'R' },
      { type: 'whoami_clue', clueIndex: 0 }, { type: 'widget', widgetType: 'scoreboard' }, { type: 'end' },
    ];
    for (const s of samples) {
      expect(adminLabel(s)).toBe(slideshowLabel(s));
      expect(slideshowLabel(s)).toBe(quizzerLabel(s));
    }
  });
});
