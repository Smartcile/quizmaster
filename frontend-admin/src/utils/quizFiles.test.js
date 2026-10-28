import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Capture generator output without real PDF/PPTX/QR/canvas work.
const h = vi.hoisted(() => ({ docs: [], autoTable: vi.fn(), pptx: [], slides: [] }));

vi.mock('jspdf', () => {
  class Doc {
    constructor(opts) {
      this.opts = opts;
      this._fontSize = 10;
      this._maxY = 0;
      this.text = vi.fn((txt, x, y) => {
        const lines = Array.isArray(txt) ? Math.max(1, txt.length) : 1;
        const bottom = y + (lines - 1) * this._fontSize * 1.15;
        if (bottom > this._maxY) this._maxY = bottom;
      });
      this.addPage = vi.fn();
      this.setFont = vi.fn();
      this.setFontSize = vi.fn((s) => { this._fontSize = s; });
      this.setTextColor = vi.fn();
      this.setDrawColor = vi.fn();
      this.setFillColor = vi.fn();
      this.rect = vi.fn();
      this.line = vi.fn();
      this.addImage = vi.fn();
      // Rough word/character wrapping so multi-line layout can be exercised.
      this.splitTextToSize = (t, w) => {
        const str = String(t);
        const per = w ? Math.max(1, Math.floor(w / 5)) : 1000;
        const out = [];
        for (let i = 0; i < str.length; i += per) out.push(str.slice(i, i + per));
        return out.length ? out : [''];
      };
      this.getTextWidth = (t) => String(t).length * 3;
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
    addSlide() { const s = new Slide(); h.slides.push(s); return s; }
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
  h.slides.length = 0;
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

  it('shrinks a dense round so nothing is drawn past the printable area', () => {
    const dense = {
      name: 'Dense Quiz', code: 'D1',
      items: [{
        kind: 'round', id: 1, name: 'Big Round', style: 'standard',
        questions: Array.from({ length: 40 }, (_, i) => ({
          id: i + 1,
          text: `A long question text that wraps onto several lines in the PDF for question ${i + 1}`,
          answer: 'Some answer text',
          type: 'text', points: 1,
        })),
      }],
    };
    downloadQuestionsAnswers(dense);
    const doc = h.docs.at(-1);
    // A4 portrait is 842pt tall with a 40pt margin → printable bottom is 802.
    expect(doc._maxY).toBeLessThanOrEqual(802.5);
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

describe('downloadAnswerSheet — text-list images', () => {
  const imgQuiz = {
    name: 'Pic List', code: 'PIC123',
    items: [{
      kind: 'round', id: 5, name: 'Pic Round', style: 'textlist', display_title: 'Pictures',
      print_pictures: true, show_images: true, list_mode: 'plain',
      questions: [
        { id: 51, text: 'Item one', answer: 'a', type: 'image', media_url: '/uploads/pic1.jpg', points: 1 },
        { id: 52, text: 'Item two', answer: 'b', type: 'image', media_url: '/uploads/pic2.jpg', points: 1 },
      ],
    }],
  };

  // jsdom has no real image decoder / canvas — stub both so imageForPdf resolves.
  beforeEach(() => {
    vi.stubGlobal('Image', class {
      naturalWidth = 100;
      naturalHeight = 80;
      set src(_v) { queueMicrotask(() => this.onload && this.onload()); }
    });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ fillStyle: '', fillRect() {}, drawImage() {} });
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/jpeg;base64,AAAA');
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it('prints a picture for each item when show_images is on', async () => {
    await downloadAnswerSheet(imgQuiz);
    expect(h.docs.at(-1).addImage).toHaveBeenCalledTimes(2);
  });

  it('prints no pictures when show_images is off', async () => {
    const off = { ...imgQuiz, items: [{ ...imgQuiz.items[0], show_images: false }] };
    await downloadAnswerSheet(off);
    expect(h.docs.at(-1).addImage).not.toHaveBeenCalled();
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

  it('adds item images to a textlist slide when show_images is on', async () => {
    const picList = {
      name: 'Pic List', code: 'PIC123',
      items: [{
        kind: 'round', id: 1, name: 'Pics', style: 'textlist', show_images: true, list_mode: 'plain',
        questions: [{ id: 1, text: 'One', type: 'image', media_url: '/u/1.jpg', answer: 'a' }],
      }],
    };
    await downloadSlideshowPptx(picList);
    const listSlide = h.slides.find(s => s.addText.mock.calls.some(c => c[0] === 'Pics'));
    expect(listSlide.addImage).toHaveBeenCalledWith(expect.objectContaining({ path: '/u/1.jpg' }));
  });
});
