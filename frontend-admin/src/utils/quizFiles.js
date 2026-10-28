// Client-side "Download Quiz Files" generators — printable PDFs + a PPTX deck,
// produced entirely in the browser from a full quiz object (rounds → questions
// with answers/options, plus the resolved Who/What Am I widget). Used as an
// offline fallback if the live apps go down.

import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { QRCodeCanvas } from 'qrcode.react';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import PptxGenJS from 'pptxgenjs';
import { buildSlides } from './buildSlides';
import { api } from '../services/api';

// ── shared helpers ────────────────────────────────────────────────────────────
const M = 40;                 // page margin (pt)
const PAGE_W = 595, PAGE_H = 842;   // A4 portrait in pt
const CONTENT_W = PAGE_W - M * 2;
// Answer-sheet join QR sits in the top-right; content that would overlap it
// (the Who Am I? box) is pushed below this y.
const QR_SAFE_Y = M + 80;

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
// An intermission round that should have its pictures printed on the answer sheet
const printsPictures = (round) => round.style === 'intermission' && !!round.print_pictures;
// A textlist round that should have its item list printed on the answer sheet
// (reuses the same flag — the Round Builder relabels the toggle per style).
const printsItems = (round) => round.style === 'textlist' && !!round.print_pictures;
// Any round whose pictures need pre-loading for the answer sheet: an intermission
// grid, or a textlist whose items show images.
const needsSheetImages = (round) =>
  printsPictures(round) || (printsItems(round) && !!round.show_images);

// ── join link + QR ────────────────────────────────────────────────────────────
// Same rule as the Control page: QUIZZER_URL from /api/config, else the current
// hostname on the quizzer port. Deep link = <base>/<quiz code>.
async function quizzerJoinUrl(quiz) {
  let base = null;
  try { base = (await api.get('/config'))?.quizzerUrl || null; } catch { /* offline */ }
  if (!base) base = `${window.location.protocol}//${window.location.hostname}:3003`;
  return `${base.replace(/\/+$/, '')}/${quiz.code || ''}`;
}

// Render a QR to a PNG data URL using the same lib the slideshow uses (no new
// dependency, works offline). React 18 renders async, so poll for the canvas.
async function qrDataUrl(text, px = 220) {
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-9999px;top:0;width:0;height:0;overflow:hidden';
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    root.render(createElement(QRCodeCanvas, { value: text, size: px, level: 'M', includeMargin: true }));
    let canvas = null;
    for (let i = 0; i < 40 && !canvas; i++) {
      await new Promise(r => requestAnimationFrame(r));
      canvas = host.querySelector('canvas');
    }
    return canvas ? canvas.toDataURL('image/png') : null;
  } catch {
    return null;
  } finally {
    root.unmount();
    host.remove();
  }
}

// Decode an image and re-encode it as a print-sized JPEG data URL. Normalising
// through a canvas means webp/gif/transparent PNGs all work (jsPDF only takes
// PNG/JPEG) and keeps the PDF a sane size. Same-origin /uploads → no tainting.
async function imageForPdf(url, maxPx = 900) {
  try {
    const img = await new Promise((res, rej) => {
      const im = new Image();
      im.onload = () => res(im);
      im.onerror = rej;
      im.src = url;
    });
    const scale = Math.min(1, maxPx / Math.max(img.naturalWidth, img.naturalHeight, 1));
    const canvas = document.createElement('canvas');
    canvas.width  = Math.max(1, Math.round(img.naturalWidth  * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';                       // flatten transparency
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return { dataUrl: canvas.toDataURL('image/jpeg', 0.82), w: canvas.width, h: canvas.height };
  } catch {
    return null;   // missing/broken file — the cell falls back to an empty box
  }
}
const hasOptions  = (q) => {
  const m = q.answer_mode;
  return (m === 'mcq' || m === 'both') && Array.isArray(q.options) && q.options.filter(o => String(o).trim()).length > 0;
};

// ── 1) Quizzer answer sheet (no answers) ──────────────────────────────────────
// Blank fill-in boxes only — the question TEXT is never printed (teams read the
// question off the screen). Multiple-choice questions get lettered tick boxes;
// everything else gets a write-in box. Every round is sized to fit on exactly
// one page by dividing the remaining height across the questions.
export async function downloadAnswerSheet(quiz) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const rounds = getRounds(quiz);
  const whoami = getWhoami(quiz);
  if (rounds.length === 0) { doc.text('This quiz has no rounds.', M, M); doc.save(`${safe(quiz.code)}-answer-sheet.pdf`); return; }

  // Join QR — printed on every page so a team can rejoin from whichever sheet is
  // in front of them. Generated once and reused.
  const joinUrl = await quizzerJoinUrl(quiz);
  const qr = await qrDataUrl(joinUrl);

  // Pre-load the pictures for any round that prints its grid (async work can't
  // happen mid-render). Keyed by round id → [{ questionId, img }].
  const pics = new Map();
  for (const round of rounds.filter(needsSheetImages)) {
    const loaded = await Promise.all(
      questionsOf(round).map(async q => ({ q, img: q.media_url ? await imageForPdf(q.media_url) : null }))
    );
    pics.set(round.id, loaded);
  }

  // Leave room on the right for the join QR so long quiz/round names wrap
  // instead of running under it or off the page.
  const HEADER_W = CONTENT_W - 96;

  rounds.forEach((round, ri) => {
    if (ri > 0) doc.addPage();
    let y = M;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.setTextColor(0);
    const titleLines = doc.splitTextToSize(String(quiz.name || 'Quiz'), HEADER_W);
    doc.text(titleLines, M, y); y += titleLines.length * 18;
    doc.setFontSize(12); doc.setFont('helvetica', 'normal');
    const roundLabel = `Round ${ri + 1}: ${(round.style === 'intermission' || round.style === 'textlist') ? (round.display_title || round.name || '') : (round.name || '')}`;
    const roundLines = doc.splitTextToSize(roundLabel, HEADER_W);
    doc.text(roundLines, M, y); y += roundLines.length * 14 + 6;
    doc.setDrawColor(150); doc.line(M, y, PAGE_W - M, y); y += 16;

    // Team + size on every page: a round is often printed/handed out on its own,
    // and the host fills the name in on paper while going round the room.
    doc.setFontSize(10);
    doc.text('Team:', M, y); doc.rect(M + 34, y - 9, 210, 15);
    doc.text('Size:', M + 258, y); doc.rect(M + 288, y - 9, 45, 15);
    y += 24;

    // Who Am I? — one clue is revealed before each round, so give every page that
    // has a clue its own guess area, labelled with that clue's number and value.
    // (buildSlides pairs round i with clue i, bounded by the clue count.)
    if (whoami && ri < whoami.clues.length) {
      // Keep the tinted box clear of the QR + join URL in the top-right corner.
      y = Math.max(y, QR_SAFE_Y);
      y = drawWhoamiBox(doc, y, whoami, ri);
    }

    // Draw the join QR last so a later box can never paint over it.
    drawJoinQr(doc, qr, joinUrl);

    const qs = questionsOf(round);
    if (qs.length === 0) return;

    // Picture round printed on paper: numbered thumbnails, each with its own
    // answer box, sized so the whole grid fits this page.
    if (printsPictures(round)) {
      drawPictureGrid(doc, y, pics.get(round.id) || [], round.grid_columns || 4);
      return;
    }

    // Text-list round printed on paper: numbered item text + a write-in box.
    if (printsItems(round)) {
      drawTextList(doc, y, qs, round, pics.get(round.id) || []);
      return;
    }

    // Divide the remaining vertical space evenly so the whole round fits.
    const bottom = PAGE_H - M;
    let gap = 8;
    let rowH = Math.floor((bottom - y - gap * (qs.length - 1)) / qs.length);
    if (rowH < 26) { gap = 4; rowH = Math.floor((bottom - y - gap * (qs.length - 1)) / qs.length); }
    if (rowH < 16) { gap = 2; rowH = Math.floor((bottom - y - gap * (qs.length - 1)) / qs.length); }
    rowH = Math.max(10, Math.min(56, rowH));

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

// Small join QR in the top-right corner of the current page, with the URL under
// it as a fallback for anyone who can't scan.
function drawJoinQr(doc, qr, joinUrl) {
  if (!qr) return;
  const size = 56;
  const x = PAGE_W - M - size;
  doc.addImage(qr, 'PNG', x, M - 14, size, size);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(6); doc.setTextColor(90);
  doc.text('Scan to join', x + size / 2, M + size - 6, { align: 'center' });
  const url = String(joinUrl || '').replace(/^https?:\/\//, '');
  // A URL has no spaces to wrap on, so shrink the font until it fits under the
  // QR rather than letting it run off the right edge.
  if (typeof doc.getTextWidth === 'function') {
    let fs = 6;
    while (fs > 3 && doc.getTextWidth(url) > size) { fs -= 0.25; doc.setFontSize(fs); }
  }
  doc.text(url, x + size / 2, M + size + 2, { align: 'center' });
  doc.setTextColor(0);
}

// Who Am I? guess area for the clue shown before this round. Boxed and tinted so
// it reads as separate from the round's answers. Returns the new y.
function drawWhoamiBox(doc, y, whoami, clueIdx) {
  const clue = whoami.clues[clueIdx] || {};
  const pts = clue.points ?? '';
  const padX = 6;
  const innerW = CONTENT_W - padX * 2;

  doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(60);
  const title = `${(whoami.title || 'WHO AM I?').toUpperCase()} — CLUE ${clueIdx + 1}${pts !== '' ? ` (${pts} pt)` : ''}`;
  const titleLines = doc.splitTextToSize(title, innerW);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7);
  const noteLines = doc.splitTextToSize(
    'Only your first correct guess scores — the earlier the clue, the more it is worth.',
    innerW
  );

  const titleH = titleLines.length * 9;
  const noteH = noteLines.length * 8;
  const H = titleH + noteH + 28;

  doc.setFillColor(245, 245, 250);
  doc.setDrawColor(140);
  doc.rect(M, y - 10, CONTENT_W, H, 'FD');

  doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(60);
  doc.text(titleLines, M + padX, y);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7);
  doc.text(noteLines, M + padX, y + titleH + 2);

  // Guess line
  const guessY = y + titleH + noteH + 10;
  doc.setFontSize(8); doc.setTextColor(0);
  doc.text('Guess:', M + padX, guessY);
  doc.setDrawColor(120);
  doc.line(M + 34, guessY, PAGE_W - M - 8, guessY);
  doc.setTextColor(0);
  return y + titleH + noteH + 26;
}

// Numbered picture grid + a write-in box per picture, scaled to fit one page.
// `cells` is [{ q, img }] — a missing image just leaves an empty framed box.
function drawPictureGrid(doc, top, cells, cols) {
  const n = cells.length;
  if (n === 0) return;
  const gap = 8, ansH = 16, capH = 11;
  const rows = Math.ceil(n / cols);
  const cellW = (CONTENT_W - gap * (cols - 1)) / cols;
  // Never force a minimum cell height that would push the last row off the page.
  const cellH = Math.max(20, (PAGE_H - M - top - gap * (rows - 1)) / rows);
  const imgH = Math.max(4, cellH - ansH - capH - 4);

  // Only the picture is printed — the question text stays on the screen.
  cells.forEach(({ img }, i) => {
    const r = Math.floor(i / cols), c = i % cols;
    const x = M + c * (cellW + gap);
    const y = top + r * (cellH + gap);

    // Picture, letterboxed inside its frame so nothing is distorted
    doc.setDrawColor(150);
    doc.rect(x, y, cellW, imgH);
    if (img) {
      const s = Math.min(cellW / img.w, imgH / img.h);
      const w = img.w * s, h = img.h * s;
      doc.addImage(img.dataUrl, 'JPEG', x + (cellW - w) / 2, y + (imgH - h) / 2, w, h);
    } else {
      // Say so rather than leaving a mysteriously blank frame.
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(150);
      doc.text('image unavailable', x + cellW / 2, y + imgH / 2, { align: 'center' });
      doc.setTextColor(0);
    }

    // Number badge (white box so it stays readable over a dark picture)
    doc.setFillColor(255, 255, 255);
    doc.rect(x + 2, y + 2, 15, 12, 'F');
    doc.setDrawColor(150); doc.rect(x + 2, y + 2, 15, 12);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(0);
    doc.text(String(i + 1), x + 9.5, y + 10.5, { align: 'center' });

    // Answer box for this picture
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(90);
    doc.text(`${i + 1}.`, x, y + imgH + capH - 1);
    doc.setTextColor(0);
    doc.setDrawColor(120);
    doc.rect(x + 12, y + imgH + 3, cellW - 12, ansH - 3);
  });
}

// Numbered text-list round printed on paper: each item's text with a write-in
// box on the right, plus the shared option legend for match mode. When the round
// has show_images on, a thumbnail of each item's picture is printed to the left
// of its text. Sized to fit the remaining page height.
function drawTextList(doc, top, qs, round, pics) {
  let y = top;
  const opts = Array.isArray(round.list_options) ? round.list_options : [];
  if (round.list_mode === 'match' && opts.length) {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(60);
    const legend = doc.splitTextToSize(`Options: ${opts.join('   ·   ')}`, CONTENT_W);
    doc.text(legend, M, y);
    doc.setTextColor(0);
    // Advance by the legend's real line count so item rows never overlap it.
    y += legend.length * 11 + 4;
  }
  const n = qs.length;
  if (n === 0) return;
  let gap = 8;
  let rowH = Math.floor((PAGE_H - M - y - gap * (n - 1)) / n);
  if (rowH < 24) { gap = 4; rowH = Math.floor((PAGE_H - M - y - gap * (n - 1)) / n); }
  rowH = Math.max(16, Math.min(58, rowH));
  const textW = CONTENT_W * 0.62;
  const boxX = M + textW + 10;
  const boxW = PAGE_W - M - boxX;

  // Optional per-item thumbnail (only when the round is set to show images).
  const withImages = !!round.show_images;
  const imgById = new Map((pics || []).map(p => [p.q.id, p.img]));
  const thumbW = withImages ? 46 : 0;
  const textLeft = M + 22 + (withImages ? thumbW + 6 : 0);

  qs.forEach((q, i) => {
    doc.setDrawColor(120);
    doc.rect(M, y, CONTENT_W, rowH);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(Math.min(11, rowH - 4));
    doc.text(`${i + 1}.`, M + 6, y + rowH / 2 + 4);

    if (withImages) {
      const im = imgById.get(q.id);
      const th = rowH - 8;
      if (im) {
        let w = thumbW, h = w / (im.w / im.h || 1);
        if (h > th) { h = th; w = h * (im.w / im.h || 1); }
        doc.addImage(im.dataUrl, 'JPEG', M + 22 + (thumbW - w) / 2, y + (rowH - h) / 2, w, h);
      } else {
        doc.setDrawColor(190); doc.rect(M + 22, y + 4, thumbW, rowH - 8);
      }
      doc.setDrawColor(120);
    }

    doc.setFont('helvetica', 'normal');
    const fontSize = Math.max(6, Math.min(11, rowH - 4));
    doc.setFontSize(fontSize);
    const textLimit = Math.max(40, (boxX - 8) - textLeft);
    const lineH = fontSize * 1.15;
    const maxLines = Math.max(1, Math.floor((rowH - 4) / lineH));
    let lines = doc.splitTextToSize(q.text || '', textLimit);
    if (lines.length > maxLines) {
      // Only truncate when the row genuinely can't fit the text, and mark it.
      lines = lines.slice(0, maxLines);
      const last = lines[maxLines - 1];
      const trimmed = last.replace(/\s*\S*$/, '');
      lines[maxLines - 1] = `${trimmed || last}…`;
    }
    const startY = y + rowH / 2 + 4 - (lines.length - 1) * lineH / 2;
    doc.text(lines, textLeft, startY);
    // write-in box
    doc.setDrawColor(120);
    doc.rect(boxX, y + 3, boxW, rowH - 6);
    y += rowH + gap;
  });
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
    const t = doc.splitTextToSize(`${whoami.title} - Answer`, CONTENT_W);
    doc.text(t, M, y); y += t.length * 18 + 6;
    doc.setFontSize(13); doc.setTextColor(0, 120, 0);
    const a = doc.splitTextToSize(`Answer: ${whoami.answer || ''}`, CONTENT_W);
    doc.text(a, M, y); y += a.length * 15 + 4; doc.setTextColor(0);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(11);
    whoami.clues.forEach((c, i) => {
      const cl = doc.splitTextToSize(`Clue ${i + 1} (${c.points ?? ''} pt): ${c.text || ''}`, CONTENT_W);
      const needed = cl.length * 14 + 4;
      // Break before the clue if the whole (wrapped) clue wouldn't fit.
      if (y + needed > PAGE_H - M) { doc.addPage(); y = M; }
      doc.text(cl, M, y); y += needed;
    });
  }
  doc.save(`${safe(quiz.code)}-questions-answers.pdf`);
}

// Render one round's Q&A onto exactly one page, shrinking the text to fit.
function renderRoundQA(doc, quiz, round, ri) {
  const qs = questionsOf(round);
  const B = { title: 11, opt: 10, ans: 10, lhTitle: 14, lhOpt: 14, lhAns: 13, qGap: 12 };

  // Draw the (wrapped) header first, then use the actual remaining height for
  // the fit. The old code assumed a 60pt header but the header really ends at
  // ~82pt, so content ended ~22pt below the printable area and got clipped.
  let y = M;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.setTextColor(0);
  const titleLines = doc.splitTextToSize(`${quiz.name || 'Quiz'} - Answers`, CONTENT_W);
  doc.text(titleLines, M, y); y += titleLines.length * 18 + 2;
  doc.setFontSize(13); doc.setFont('helvetica', 'normal');
  const roundLines = doc.splitTextToSize(`Round ${ri + 1}: ${round.name || ''}`, CONTENT_W);
  doc.text(roundLines, M, y); y += roundLines.length * 15 + 6;
  doc.setDrawColor(150); doc.line(M, y, PAGE_W - M, y); y += 16;
  const contentTop = y;
  const avail = PAGE_H - M - contentTop;

  // Measure the content at full size, splitting the height into the parts that
  // scale with the font (wrapped text + gaps) and the fixed per-question padding.
  const measure = () => {
    let fixed = 0, scaled = 0;
    qs.forEach((q, qi) => {
      doc.setFontSize(B.title);
      scaled += doc.splitTextToSize(`${qi + 1}. ${q.text || ''}   (${q.points ?? 1} pt)`, CONTENT_W).length * B.lhTitle;
      fixed += 2;
      if (hasOptions(q)) {
        doc.setFontSize(B.opt);
        q.options.filter(o => String(o).trim()).forEach((opt, oi) => {
          scaled += doc.splitTextToSize(`${String.fromCharCode(65 + oi)}. ${opt}`, CONTENT_W - 36).length * B.lhOpt;
        });
        fixed += 2;
      }
      doc.setFontSize(B.ans);
      scaled += doc.splitTextToSize(`Answer: ${q.answer || ''}`, CONTENT_W - 14).length * B.lhAns + B.qGap;
    });
    return { fixed, scaled };
  };
  const { fixed, scaled } = measure();
  // Solve scaled*s + fixed = avail so the fixed padding can't push past the page.
  const s = scaled > 0 ? Math.min(1, Math.max(0.2, (avail - fixed) / scaled)) : 1;

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
        if (correct) {
          doc.setFillColor(255, 241, 118);
          doc.rect(M + 14, y - 9 * s, CONTENT_W - 28, B.opt * 1.15 * s * ol.length, 'F');
          doc.setFont('helvetica', 'bold');
        } else doc.setFont('helvetica', 'normal');
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
  const TOP = 44, BOTTOM = 24;
  if (rounds.length === 0) { doc.text('This quiz has no rounds.', M, M); doc.save(`${safe(quiz.code)}-marking-form.pdf`); return; }

  doc.setFont('helvetica', 'bold'); doc.setFontSize(14); doc.setTextColor(0);
  doc.text(`${quiz.name || 'Quiz'} - Marking sheet`, M, 30);

  const head = [['Team', ...rounds.map((r, i) => r.name || `Round ${i + 1}`), 'Total']];
  const body = Array.from({ length: TEAMS }, () => ['', ...rounds.map(() => ''), '']);

  // Landscape A4 is 842 x 595. Fit all 12 rows on the single page: shrink the
  // row height and header font when there are lots of round columns so the grid
  // never spills onto a second page.
  const availH = 595 - TOP - BOTTOM;
  const headH = rounds.length > 8 ? 34 : 24;
  const rowH = Math.max(18, Math.min(30, (availH - headH) / TEAMS));
  autoTable(doc, {
    head, body, startY: TOP,
    margin: { left: M, right: M, top: M, bottom: BOTTOM },
    theme: 'grid',
    styles: { minCellHeight: rowH, fontSize: 10, halign: 'center', valign: 'middle', lineColor: [120, 120, 140] },
    headStyles: {
      fillColor: [40, 40, 64], textColor: [255, 255, 255],
      fontSize: rounds.length > 10 ? 8 : 10
    },
    columnStyles: { 0: { halign: 'left', cellWidth: rounds.length > 8 ? 110 : 150 } }
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
          if (q.mediaUrl && q.questionType === 'image') {
            slide.addImage({ path: q.mediaUrl, x, y, w: cw, h: ch, sizing: { type: 'cover', w: cw, h: ch } });
          } else {
            slide.addShape(pptx.ShapeType.rect, { x, y, w: cw, h: ch, fill: { color: '12203A' }, line: { color: C.CYAN, width: 1 } });
          }
          slide.addText(String(i + 1), { x, y, w: 0.4, h: 0.3, align: 'center', fontSize: 12, bold: true, color: C.WHITE });
        });
        break;
      }
      case 'textlist': {
        slide.addText(String(s.title || 'Text Round'), { x: 0.5, y: 0.4, w: W - 1, h: 0.8, align: 'center', fontSize: 32, bold: true, color: C.CYAN });
        const tqs = s.questions || [];
        const topts = Array.isArray(s.listOptions) ? s.listOptions : [];
        let listY = 1.4;
        if (s.listMode === 'match' && topts.length) {
          slide.addText(`Options: ${topts.join('  ·  ')}`, { x: 1, y: listY, w: W - 2, h: 0.5, align: 'center', fontSize: 18, color: C.PURPLE });
          listY += 0.6;
        }
        const areaH = Math.max(1, 7.2 - listY);
        if (s.showImages) {
          // One row per item: thumbnail on the left, text beside it.
          const rowH = Math.min(1.5, areaH / Math.max(1, tqs.length));
          const thumbW = rowH * 0.9;
          tqs.forEach((q, i) => {
            const ry = listY + i * rowH;
            const tx = 1 + thumbW + 0.15;
            if (q.mediaUrl && q.questionType === 'image') {
              try {
                slide.addImage({ path: q.mediaUrl, x: 1, y: ry, w: thumbW, h: rowH * 0.9, sizing: { type: 'contain', w: thumbW, h: rowH * 0.9 } });
              } catch { /* missing file — the row still prints its text */ }
            }
            slide.addText(`${i + 1}.  ${q.text}`, { x: tx, y: ry, w: W - tx - 1, h: rowH, valign: 'middle', fontSize: 16, color: C.WHITE });
          });
        } else {
          slide.addText(
            tqs.map((q, i) => ({ text: `${i + 1}.  ${q.text}`, options: { breakLine: true } })),
            { x: 1, y: listY, w: W - 2, h: areaH, align: 'left', fontSize: 18, color: C.WHITE }
          );
        }
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
