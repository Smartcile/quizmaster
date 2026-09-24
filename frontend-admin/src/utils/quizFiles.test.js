import { describe, it, expect, beforeEach, vi } from 'vitest';

// Capture generator output without real PDF/PPTX/QR/canvas work.
const h = vi.hoisted(() => ({ docs: [], autoTable: vi.fn(), pptx: [] }));

vi.mock('jspdf', () => {
  class Doc {
    constructor(opts) {
      this.opts = opts;
      this.text = vi.fn();
      this.addPage = vi.fn();
      this.setFont = vi.fn();
      this.setFontSize = vi.fn();
      this.setTextColor = vi.fn();
      this.setDrawColor = vi.fn();
      this.setFillColor = vi.fn();
      this.rect = vi.fn();
      this.line = vi.fn();
      this.addImage = vi.fn();
      this.splitTextToSize = (t) => [String(t)];
      this.save = vi.fn();
      h.docs.push(this);
    }
  }
  return { jsPDF: Doc };
});
vi.mock('jspdf-autotable', () => ({ default: h.autoTable }));
vi.mock('qrcode.react', () => ({ QRCodeCanvas: () => null }));
vi.mock('pptxgenjs', () => {
  class Slide {
    constructor() { this.background = null; this.addText = vi.fn(); this.addImage = vi.fn(); this.addShape = vi.fn(); }
  }
  class Pptx {
    constructor() { this.layout = ''; this.ShapeType = { rect: 'rect' }; this.writeFile = vi.fn(() => Promise.resolve()); h.pptx.push(this); }
    addSlide() { return new Slide(); }
  }
  return { default: Pptx };
});
vi.mock('../services/api', () => ({ api: { get: vi.fn(() => Promise.resolve({ quizzerUrl: 'http://quizzer.test' })) } }));

import {
  downloadAnswerSheet, downloadQuestionsAnswers, downloadMarkingForm, downloadSlideshowPptx,
} from './quizFiles.js';

const quiz = {
  name: 'Fixture Quiz',
  code: 'ABC123',
  items: [
    { kind: 'round', id: 1, name: 'Round One', style: 'standard', questions: [{ id: 11, text: 'Capital of France?', answer: 'Paris', type: 'text', points: 1 }] },
    { kind: 'round', id: 2, name: 'Round Two', style: 'standard', questions: [{ id: 21, text: 'Q2', answer: 'A2', type: 'text', points: 2 }] },
  ],
};

beforeEach(() => {
  h.docs.length = 0;
  h.pptx.length = 0;
  h.autoTable.mockClear();
});

describe('downloadMarkingForm', () => {
  it('lays out a Team × round columns grid with 12 blank team rows', () => {
    downloadMarkingForm(quiz);
    expect(h.autoTable).toHaveBeenCalledTimes(1);
    const opts = h.autoTable.mock.calls[0][1];
    expect(opts.head[0]).toEqual(['Team', 'Round One', 'Round Two', 'Total']);
    expect(opts.body).toHaveLength(12);
    expect(h.docs.at(-1).save).toHaveBeenCalledWith('ABC123-marking-form.pdf');
  });
});

describe('downloadQuestionsAnswers', () => {
  it('renders one page per round and saves the PDF', () => {
    downloadQuestionsAnswers(quiz);
    const doc = h.docs.at(-1);
    // One page for the first round + one added for the second
    expect(doc.addPage).toHaveBeenCalledTimes(1);
    expect(doc.text).toHaveBeenCalled();
    expect(doc.save).toHaveBeenCalledWith('ABC123-questions-answers.pdf');
  });
});

describe('downloadAnswerSheet', () => {
  it('prints blank boxes (no answers) and saves the PDF', async () => {
    await downloadAnswerSheet(quiz);
    const doc = h.docs.at(-1);
    // Never leaks the correct answer onto the team sheet
    const printed = doc.text.mock.calls.flat().map(a => String(a)).join(' ');
    expect(printed).not.toContain('Paris');
    expect(doc.save).toHaveBeenCalledWith('ABC123-answer-sheet.pdf');
  });
});

describe('downloadSlideshowPptx', () => {
  it('builds a deck from buildSlides and writes the file', async () => {
    await downloadSlideshowPptx(quiz);
    const pptx = h.pptx.at(-1);
    expect(pptx.writeFile).toHaveBeenCalledWith({ fileName: 'ABC123-slideshow.pptx' });
    // intro + round1(intro,q,mark,answer) + round2(...) + end = 10 slides
    expect(pptx.writeFile).toHaveBeenCalledTimes(1);
  });
});
