// Client-side "Download Quiz Files" generators — printable PDFs + a PPTX deck,
// produced entirely in the browser from a full quiz object (rounds → questions
// with answers/options, plus the resolved Who/What Am I widget). Used as an
// offline fallback if the live apps go down.

import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import PptxGenJS from 'pptxgenjs';
import { buildSlides } from './buildSlides';

// ── shared helpers ────────────────────────────────────────────────────────────
const M = 40;                 // page margin (pt)
const PAGE_W = 595, PAGE_H = 842;   // A4 portrait in pt
const CONTENT_W = PAGE_W - M * 2;

const safe = (s) => String(s || 'quiz').replace(/[^a-z0-9_-]+/gi, '_');
const norm = (s) => String(s ?? '').toLowerCase().trim().replace(/\s+/g, ' ').replace(/^the\s+/, '');

function unifiedItems(quiz) {
  return quiz.items || [
    ...(quiz.rounds  || []).map(r => ({ kind: 'round',  ...r })),
    ...(quiz.widgets || []).map(w => ({ kind: 'widget', ...w }))
  ];
}
function getRounds(quiz) {
  return unifiedItems(quiz).filter(i => i.kind === 'round');
}
function getWhoami(quiz) {
  const w = unifiedItems(quiz).find(i => i.kind === 'widget' && i.type === 'whoami');
  if (!w) return null;
  let d = w.data;
  if (typeof d === 'string') { try { d = JSON.parse(d); } catch { d = {}; } }
  return { title: d?.title || 'Who Am I?', answer: d?.answer || '', clues: Array.isArray(d?.clues) ? d.clues : [] };
}
const questionsOf = (round) => (round.questions || []).filter(q => q && q.id);
const hasOptions  = (q) => {
  const m = q.answer_mode;
  return (m === 'mcq' || m === 'both') && Array.isArray(q.options) && q.options.filter(o => String(o).trim()).length > 0;
};

// ── 1) Quizzer answer sheet (no answers) ──────────────────────────────────────
// Blank fill-in boxes only — the question TEXT is never printed (teams read the
// question off the screen). Multiple-choice questions get lettered tick boxes;
// everything else gets a write-in box. Every round is sized to fit on exactly
// one page by dividing the remaining height across the questions.
export function downloadAnswerSheet(quiz) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const rounds = getRounds(quiz);
  const whoami = getWhoami(quiz);
  if (rounds.length === 0) { doc.text('This quiz has no rounds.', M, M); doc.save(`${safe(quiz.code)}-answer-sheet.pdf`); return; }

  rounds.forEach((round, ri) => {
    if (ri > 0) doc.addPage();
    let y = M;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.setTextColor(0);
    doc.text(String(quiz.name || 'Quiz'), M, y); y += 18;
    doc.setFontSize(12); doc.setFont('helvetica', 'normal');
    doc.text(`Round ${ri + 1}: ${round.name || ''}`, M, y); y += 6;
    doc.setDrawColor(150); doc.line(M, y, PAGE_W - M, y); y += 16;

    if (ri === 0) {
      doc.setFontSize(10);
      doc.text('Team:', M, y); doc.rect(M + 34, y - 9, 210, 15);
      doc.text('Size:', M + 258, y); doc.rect(M + 288, y - 9, 45, 15);
      y += 24;
      if (whoami) {
        doc.text('Who Am I? final guess:', M, y);
        doc.rect(M + 125, y - 9, CONTENT_W - 125, 15);
        y += 24;
      }
    }

    const qs = questionsOf(round);
    if (qs.length === 0) return;

    // Divide the remaining vertical space evenly so the whole round fits.
    const bottom = PAGE_H - M;
    let gap = 8;
    let rowH = Math.floor((bottom - y - gap * (qs.length - 1)) / qs.length);
    if (rowH < 26) { gap = 4; rowH = Math.floor((bottom - y - gap * (qs.length - 1)) / qs.length); }
    rowH = Math.max(13, Math.min(56, rowH));

    const numW = 22;
    const boxX = M + numW;
    const boxW = CONTENT_W - numW;

    qs.forEach((q, qi) => {
      const top = y;
      doc.setFont('helvetica', 'bold'); doc.setFontSize(Math.min(12, rowH - 2));
      doc.setTextColor(0);
      doc.text(`${qi + 1}.`, M, top + rowH / 2 + 4);

      if (hasOptions(q)) {
        // Lettered tick boxes (no option text — read off the screen)
        const n = q.options.filter(o => String(o).trim()).length;
        const sq = Math.max(8, Math.min(16, rowH - 6));
        const cy = top + (rowH - sq) / 2;
        let cx = boxX;
        for (let oi = 0; oi < n; oi++) {
          if (cx > PAGE_W - M - sq - 16) break; // never spill off the right edge
          doc.setDrawColor(120); doc.rect(cx, cy, sq, sq);
          doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
          doc.text(String.fromCharCode(65 + oi), cx + sq + 4, cy + sq - 3);
          cx += sq + 30;
        }
      } else {
        doc.setDrawColor(120); doc.rect(boxX, top, boxW, rowH);
      }
      y += rowH + gap;
    });
  });
  doc.save(`${safe(quiz.code)}-answer-sheet.pdf`);
}

// ── 2) Questions & answers (marking reference) ────────────────────────────────
export function downloadQuestionsAnswers(quiz) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const rounds = getRounds(quiz);
  const whoami = getWhoami(quiz);
  if (rounds.length === 0) { doc.text('This quiz has no rounds.', M, M); doc.save(`${safe(quiz.code)}-questions-answers.pdf`); return; }

  // One page per round — auto-shrink the text so a round never spills onto a
  // second page.
  rounds.forEach((round, ri) => {
    if (ri > 0) doc.addPage();
    renderRoundQA(doc, quiz, round, ri);
  });

  if (whoami) {
    doc.addPage(); let y = M;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(16);
    doc.text(`${whoami.title} - Answer`, M, y); y += 24;
    doc.setFontSize(13); doc.setTextColor(0, 120, 0);
    doc.text(`Answer: ${whoami.answer || ''}`, M, y); y += 22; doc.setTextColor(0);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(11);
    whoami.clues.forEach((c, i) => {
      if (y > PAGE_H - 50) { doc.addPage(); y = M; }
      const cl = doc.splitTextToSize(`Clue ${i + 1} (${c.points ?? ''} pt): ${c.text || ''}`, CONTENT_W);
      doc.text(cl, M, y); y += cl.length * 14 + 4;
    });
  }
  doc.save(`${safe(quiz.code)}-questions-answers.pdf`);
}

// Render one round's Q&A onto exactly one page, shrinking the text to fit.
function renderRoundQA(doc, quiz, round, ri) {
  const qs = questionsOf(round);
  const B = { title: 11, opt: 10, ans: 10, lhTitle: 14, lhOpt: 14, lhAns: 13, qGap: 12 };
  const headerH = 60;
  const avail = PAGE_H - headerH - M;

  // Estimate the content height at full size (wrap widths are fixed)
  const estimate = () => {
    let h = 0;
    qs.forEach((q, qi) => {
      doc.setFontSize(B.title);
      h += doc.splitTextToSize(`${qi + 1}. ${q.text || ''}   (${q.points ?? 1} pt)`, CONTENT_W).length * B.lhTitle + 2;
      if (hasOptions(q)) {
        doc.setFontSize(B.opt);
        q.options.filter(o => String(o).trim()).forEach((opt, oi) => {
          h += doc.splitTextToSize(`${String.fromCharCode(65 + oi)}. ${opt}`, CONTENT_W - 36).length * B.lhOpt;
        });
        h += 2;
      }
      doc.setFontSize(B.ans);
      h += doc.splitTextToSize(`Answer: ${q.answer || ''}`, CONTENT_W - 14).length * B.lhAns + B.qGap;
    });
    return h;
  };
  const needed = estimate();
  const s = needed > avail ? Math.max(0.5, avail / needed) : 1;

  let y = M;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.setTextColor(0);
  doc.text(`${quiz.name || 'Quiz'} - Answers`, M, y); y += 20;
  doc.setFontSize(13); doc.setFont('helvetica', 'normal');
  doc.text(`Round ${ri + 1}: ${round.name || ''}`, M, y); y += 6;
  doc.setDrawColor(150); doc.line(M, y, PAGE_W - M, y); y += 16;

  qs.forEach((q, qi) => {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(B.title * s); doc.setTextColor(0);
    const ql = doc.splitTextToSize(`${qi + 1}. ${q.text || ''}   (${q.points ?? 1} pt)`, CONTENT_W);
    doc.text(ql, M, y); y += ql.length * B.lhTitle * s + 2;

    if (hasOptions(q)) {
      doc.setFontSize(B.opt * s);
      q.options.filter(o => String(o).trim()).forEach((opt, oi) => {
        const correct = norm(opt) === norm(q.answer);
        const line = `${String.fromCharCode(65 + oi)}. ${opt}${correct ? '   (correct)' : ''}`;
        const ol = doc.splitTextToSize(line, CONTENT_W - 36);
        if (correct) { doc.setFillColor(255, 241, 118); doc.rect(M + 14, y - 9 * s, CONTENT_W - 28, B.lhOpt * s * ol.length, 'F'); doc.setFont('helvetica', 'bold'); }
        else doc.setFont('helvetica', 'normal');
        doc.text(ol, M + 18, y); y += ol.length * B.lhOpt * s;
      });
      y += 2;
    }

    doc.setFont('helvetica', 'bold'); doc.setFontSize(B.ans * s); doc.setTextColor(0, 120, 0);
    const al = doc.splitTextToSize(`Answer: ${q.answer || ''}`, CONTENT_W - 14);
    doc.text(al, M + 14, y); y += al.length * B.lhAns * s + B.qGap * s;
    doc.setTextColor(0);
  });
}

// ── 3) Marking form (one whole-quiz grid: 12 teams × per-round columns) ───────
export function downloadMarkingForm(quiz) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'landscape' });
  const rounds = getRounds(quiz);
  const TEAMS = 12;
  if (rounds.length === 0) { doc.text('This quiz has no rounds.', 30, 30); doc.save(`${safe(quiz.code)}-marking-form.pdf`); return; }

  doc.setFont('helvetica', 'bold'); doc.setFontSize(14); doc.setTextColor(0);
  doc.text(`${quiz.name || 'Quiz'} - Marking sheet`, 30, 30);

  const head = [['Team', ...rounds.map((r, i) => r.name || `Round ${i + 1}`), 'Total']];
  const body = Array.from({ length: TEAMS }, () => ['', ...rounds.map(() => ''), '']);
  autoTable(doc, {
    head, body, startY: 44,
    theme: 'grid',
    styles: { minCellHeight: 30, fontSize: 10, halign: 'center', valign: 'middle', lineColor: [120, 120, 140] },
    headStyles: { fillColor: [40, 40, 64], textColor: [255, 255, 255] },
    columnStyles: { 0: { halign: 'left', cellWidth: 150 } }
  });
  doc.save(`${safe(quiz.code)}-marking-form.pdf`);
}

// ── 4) Slideshow deck (PPTX) ──────────────────────────────────────────────────
const C = { BG: '0A0E1F', CYAN: '00F0FF', GREEN: '00FF9F', PURPLE: 'B829FF', YELLOW: 'FFE600', WHITE: 'E8EFFF', MUTED: '8B9DC3' };

export async function downloadSlideshowPptx(quiz) {
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE'; // 13.33 x 7.5 in
  const W = 13.33;
  const slides = buildSlides(quiz);

  slides.forEach((s, idx) => {
    const slide = pptx.addSlide();
    slide.background = { color: C.BG };

    switch (s.type) {
      case 'intro':
        slide.addText(String(s.title || quiz.name || ''), { x: 0.5, y: 2.5, w: W - 1, h: 1.3, align: 'center', fontSize: 44, bold: true, color: C.CYAN });
        slide.addText(String(s.subtitle || ''), { x: 0.5, y: 3.9, w: W - 1, h: 0.6, align: 'center', fontSize: 20, color: C.MUTED });
        break;
      case 'round_intro':
        slide.addText('Round', { x: 0.5, y: 2.6, w: W - 1, h: 0.6, align: 'center', fontSize: 20, color: C.PURPLE });
        slide.addText(String(s.title || ''), { x: 0.5, y: 3.2, w: W - 1, h: 1.3, align: 'center', fontSize: 40, bold: true, color: C.WHITE });
        break;
      case 'intermission': {
        slide.addText(String(s.title || 'Picture Round'), { x: 0.5, y: 0.4, w: W - 1, h: 0.8, align: 'center', fontSize: 32, bold: true, color: C.CYAN });
        const cols = s.gridColumns || 5;
        const qs = (s.questions || []);
        const gx = 0.6, gy = 1.4, gw = W - 1.2, gh = 5.2, gap = 0.12;
        const cw = (gw - gap * (cols - 1)) / cols;
        const rows = Math.max(1, Math.ceil(qs.length / cols));
        const ch = (gh - gap * (rows - 1)) / rows;
        qs.forEach((q, i) => {
          const r = Math.floor(i / cols), c = i % cols;
          const x = gx + c * (cw + gap), y = gy + r * (ch + gap);
          if (q.media_url && q.type === 'image') {
            slide.addImage({ path: q.media_url, x, y, w: cw, h: ch, sizing: { type: 'cover', w: cw, h: ch } });
          } else {
            slide.addShape(pptx.ShapeType.rect, { x, y, w: cw, h: ch, fill: { color: '12203A' }, line: { color: C.CYAN, width: 1 } });
          }
          slide.addText(String(i + 1), { x, y, w: 0.4, h: 0.3, align: 'center', fontSize: 12, bold: true, color: C.WHITE });
        });
        break;
      }
      case 'whoami_clue':
        slide.addText(String(s.title || 'Who Am I?'), { x: 0.5, y: 0.5, w: W - 1, h: 0.7, align: 'center', fontSize: 26, bold: true, color: C.PURPLE });
        slide.addText(`Lock in now for ${s.points} point${s.points === 1 ? '' : 's'}`, { x: 0.5, y: 1.3, w: W - 1, h: 0.5, align: 'center', fontSize: 16, color: C.YELLOW });
        slide.addText(String(s.text || ''), { x: 1, y: 2.6, w: W - 2, h: 2.2, align: 'center', fontSize: 30, color: C.WHITE });
        break;
      case 'question':
        slide.addText(`${s.roundName || ''}   -   Q${s.questionNumber}/${s.totalInRound}   -   ${s.points} pt`,
          { x: 0.5, y: 0.4, w: W - 1, h: 0.5, align: 'center', fontSize: 16, color: C.CYAN });
        slide.addText(String(s.text || ''), { x: 0.8, y: 1.5, w: W - 1.6, h: 2, align: 'center', fontSize: 30, bold: true, color: C.WHITE });
        if (Array.isArray(s.options) && s.options.length) {
          slide.addText(
            s.options.filter(o => String(o).trim()).map((o, i) => ({ text: `${String.fromCharCode(65 + i)}.  ${o}`, options: { breakLine: true } })),
            { x: 2, y: 3.9, w: W - 4, h: 3, align: 'left', fontSize: 20, color: C.WHITE }
          );
        }
        break;
      case 'mark_answers':
        slide.addText(String(s.roundName || ''), { x: 0.5, y: 2.4, w: W - 1, h: 0.5, align: 'center', fontSize: 18, color: C.YELLOW });
        slide.addText('Mark Your Answers', { x: 0.5, y: 3, w: W - 1, h: 1, align: 'center', fontSize: 40, bold: true, color: C.WHITE });
        break;
      case 'answer':
        slide.addText(`${s.roundName || ''} - Q${s.questionNumber}`, { x: 0.5, y: 0.5, w: W - 1, h: 0.5, align: 'center', fontSize: 16, color: C.CYAN });
        slide.addText(String(s.text || ''), { x: 0.8, y: 1.6, w: W - 1.6, h: 1.8, align: 'center', fontSize: 24, color: C.MUTED });
        slide.addText(String(s.answer || ''), { x: 0.8, y: 3.8, w: W - 1.6, h: 1.5, align: 'center', fontSize: 40, bold: true, color: C.GREEN });
        break;
      case 'widget':
        slide.addText(String(s.data?.title || s.widgetType || 'Slide'), { x: 0.5, y: 3, w: W - 1, h: 1, align: 'center', fontSize: 34, bold: true, color: C.CYAN });
        if (s.widgetType === 'scoreboard') slide.addText('(Live scoreboard)', { x: 0.5, y: 4.1, w: W - 1, h: 0.6, align: 'center', fontSize: 16, color: C.MUTED });
        if (s.widgetType === 'review')     slide.addText('Review your answers & scores on your device', { x: 0.5, y: 4.1, w: W - 1, h: 0.6, align: 'center', fontSize: 16, color: C.MUTED });
        break;
      case 'end':
        slide.addText(String(s.title || 'Quiz Complete!'), { x: 0.5, y: 2.3, w: W - 1, h: 1, align: 'center', fontSize: 44, bold: true, color: C.CYAN });
        slide.addText(String(s.subtitle || ''), { x: 0.5, y: 3.5, w: W - 1, h: 0.6, align: 'center', fontSize: 20, color: C.MUTED });
        if (s.whoami && s.whoami.answer) {
          slide.addText(`${s.whoami.title}: ${s.whoami.answer}`, { x: 0.5, y: 4.4, w: W - 1, h: 0.8, align: 'center', fontSize: 24, bold: true, color: C.GREEN });
        }
        break;
      default:
        slide.addText(String(s.type || ''), { x: 0.5, y: 3, w: W - 1, h: 1, align: 'center', fontSize: 20, color: C.MUTED });
    }

    slide.addText(String(idx + 1), { x: W - 1, y: 6.9, w: 0.8, h: 0.4, align: 'right', fontSize: 10, color: C.MUTED });
  });

  await pptx.writeFile({ fileName: `${safe(quiz.code)}-slideshow.pptx` });
}
