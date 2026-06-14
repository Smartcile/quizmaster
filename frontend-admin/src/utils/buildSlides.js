function safeParse(s) { try { return JSON.parse(s); } catch { return {}; } }

// Build a flat slide list from a quiz.
// MUST stay in sync with frontend-slideshow and frontend-quizzer copies.
// Index-based sync: WebSocket sends only a slide index; all three apps must
// independently produce the exact same slide array from the same quiz object.
//
// Rounds and widgets can be freely interleaved. The quiz API returns
// quiz.items — a unified ordered array of { kind:'round'|'widget', ...fields }.
// Older quiz objects that pre-date the items field fall back to rounds-first.
export function buildSlides(quiz) {
  if (!quiz) return [];
  const slides = [];

  slides.push({
    type: 'intro',
    title: quiz.name,
    subtitle: `Quiz Code: ${quiz.code}`
  });

  // Unified item sequence: rounds and widgets can appear in any order
  const items = quiz.items || [
    ...(quiz.rounds  || []).map(r => ({ kind: 'round',  ...r })),
    ...(quiz.widgets || []).map(w => ({ kind: 'widget', ...w }))
  ];

  // A quiz may carry one "Who Am I?" — a widget with a shared answer + a list of
  // clues. Its position in `items` is irrelevant: one clue is revealed before
  // each round (round i → clue i), and the answer is revealed on the end slide.
  // We detect it here and skip rendering it as a normal widget slide.
  const whoami = parseWhoami(items);
  let roundIndex = 0;

  items.forEach(item => {
    if (item.kind === 'round') {
      // Reveal this round's Who-Am-I clue just before the round intro
      if (whoami && roundIndex < whoami.clues.length) {
        const clue = whoami.clues[roundIndex] || {};
        slides.push({
          type: 'whoami_clue',
          clueIndex: roundIndex,
          totalClues: whoami.clues.length,
          title: whoami.title,
          text: clue.text || '',
          points: clue.points,
          revealed: whoami.clues.slice(0, roundIndex + 1)
        });
      }
      roundIndex++;

      const round = item;
      slides.push({
        type: 'round_intro',
        roundId: round.id,
        title: round.name,
        background: round.background_color
      });

      const questions = (round.questions || []).filter(q => q && q.id);

      questions.forEach((q, i) => {
        slides.push({
          type: 'question',
          roundId: round.id,
          questionId: q.id,
          questionNumber: i + 1,
          totalInRound: questions.length,
          roundName: round.name,
          text: q.text,
          questionType: q.type,
          mediaUrl: q.media_url,
          options: q.options || [],
          points: q.points,
          audioForm: q.audio_form || null,
          audioStop: q.audio_stop_seconds != null ? Number(q.audio_stop_seconds) : null,
          mediaArtist: q.media_artist || null,
          mediaTitle: q.media_title || null
        });
      });

      // Mark-answers slide — sits between the round's last question and its
      // first answer reveal. Quizzers can still submit until the admin advances
      // past it (which auto-locks the round).
      if (questions.length > 0) {
        slides.push({
          type: 'mark_answers',
          roundId: round.id,
          roundName: round.name,
          totalInRound: questions.length
        });
      }

      questions.forEach((q, i) => {
        slides.push({
          type: 'answer',
          roundId: round.id,
          questionId: q.id,
          questionNumber: i + 1,
          roundName: round.name,
          text: q.text,
          answer: q.answer,
          points: q.points,
          audioForm: q.audio_form || null,
          mediaArtist: q.media_artist || null,
          mediaTitle: q.media_title || null
        });
      });

    } else if (item.kind === 'widget') {
      // The Who-Am-I widget is distributed as clue slides above — never a slide of its own
      if (item.type === 'whoami') return;
      const w = item;
      slides.push({
        type: 'widget',
        widgetType: w.type,
        data: typeof w.data === 'string' ? safeParse(w.data) : (w.data || {})
      });
    }
  });

  slides.push({
    type: 'end',
    title: 'Quiz Complete!',
    subtitle: 'Thanks for playing',
    whoami: whoami ? { title: whoami.title, answer: whoami.answer } : null
  });

  return slides;
}

// Extract the single Who-Am-I config from a quiz's items (or null).
// Shape: { title, answer, clues: [{ text, points }] }. MUST behave identically
// in all three frontend copies so slide indexes stay aligned.
function parseWhoami(items) {
  const item = (items || []).find(i => i.kind === 'widget' && i.type === 'whoami');
  if (!item) return null;
  const d = typeof item.data === 'string' ? safeParse(item.data) : (item.data || {});
  return {
    title:  d.title  || 'Who Am I?',
    answer: d.answer || '',
    clues:  Array.isArray(d.clues) ? d.clues : []
  };
}

export function slideShortLabel(slide) {
  if (!slide) return '';
  switch (slide.type) {
    case 'intro': return 'Title';
    case 'round_intro': return `Round: ${slide.title}`;
    case 'question': return `Q${slide.questionNumber} — ${slide.roundName}`;
    case 'mark_answers': return `Mark Answers — ${slide.roundName}`;
    case 'answer': return `Answer Q${slide.questionNumber} — ${slide.roundName}`;
    case 'whoami_clue': return `Who Am I? — Clue ${slide.clueIndex + 1}`;
    case 'widget': return `Widget: ${slide.widgetType}`;
    case 'end': return 'End';
    default: return slide.type;
  }
}
